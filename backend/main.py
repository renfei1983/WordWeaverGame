import os
import json
import asyncio
import httpx
import logging
import time
from typing import List, Dict, Optional, Literal
from fastapi import FastAPI, HTTPException, Query, Body, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import openai
import edge_tts
from dotenv import load_dotenv
from pathlib import Path
from sqlmodel import Session, select, func, desc
from datetime import datetime, timedelta

from db import LearningRecord, User, QuizHistory, create_db_and_tables, get_session

# Configure Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    force=True
)
logger = logging.getLogger("wordweaver")

# Load environment variables
env_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=env_path)

app = FastAPI(title="WordWeaver Backend")

@app.on_event("startup")
def on_startup():
    create_db_and_tables()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for MVP
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# AI Configuration
# Note: User needs to set SILICONFLOW_API_KEY in .env
SILICONFLOW_API_KEY = os.getenv("SILICONFLOW_API_KEY")
BASE_URL = "https://api.siliconflow.cn/v1"
MODEL = "deepseek-ai/DeepSeek-V3" # Switch to DeepSeek V3 (SiliconFlow/Pro) as requested
# MODEL = "Qwen/Qwen2.5-72B-Instruct" # Previous
# MODEL = "Qwen/Qwen3-235B-A22B-Instruct-2507" # Previous
# MODEL = "Qwen/Qwen3-Next-80B-A3B-Instruct" # Previous
# MODEL = "Pro/deepseek-ai/DeepSeek-V3.2" # Previous
# MODEL = "Qwen/Qwen2.5-72B-Instruct" # Switch to Qwen 2.5 72B (Faster & Stable)

# WeChat Configuration
WECHAT_APP_ID = os.getenv("WECHAT_APP_ID")
WECHAT_APP_SECRET = os.getenv("WECHAT_APP_SECRET")

# Initialize OpenAI client
client = openai.OpenAI(
    api_key=SILICONFLOW_API_KEY,
    base_url=BASE_URL,
    timeout=120.0  # Set timeout to 120 seconds
)

class ChatRequest(BaseModel):
    messages: List[Dict[str, str]]
    target_words: List[str]
    story_context: str

class RecordLearningRequest(BaseModel):
    user_name: Optional[str] = None # For backward compatibility
    openid: Optional[str] = None
    words: List[Dict[str, str]]
    source_level: str
    topic: str

class LoginRequest(BaseModel):
    code: str
    userInfo: Optional[Dict] = None

@app.get("/")
def read_root():
    logger.info("Health check endpoint called")
    return {"message": "WordWeaver Backend is running", "version": "1.0.8"}

@app.post("/login")
async def login(
    request: LoginRequest, 
    session: Session = Depends(get_session),
    x_wx_openid: Optional[str] = Header(None, alias="x-wx-openid")
):
    # Priority 1: Cloud Hosting Header (Trusted)
    if x_wx_openid:
        openid = x_wx_openid
        # Create/Update user
        user = session.get(User, openid)
        if not user:
             user = User(
                 openid=openid,
                 nickname=request.userInfo.get("nickName", "WeChat User") if request.userInfo else "WeChat User",
                 avatar_url=request.userInfo.get("avatarUrl", "") if request.userInfo else ""
             )
             session.add(user)
             session.commit()
        return {"openid": openid, "session_key": "cloud_hosted_session"}

    # Priority 2: Code Exchange (Legacy/Dev)
    if not WECHAT_APP_ID or not WECHAT_APP_SECRET:
        # Fallback for dev without WeChat creds, or return error
        # For now, let's assume if code starts with "test_", we mock it
        if request.code.startswith("test_"):
             mock_openid = f"openid_{request.code}"
             # Create user if not exists
             user = session.get(User, mock_openid)
             if not user:
                 user = User(
                     openid=mock_openid,
                     nickname=request.userInfo.get("nickName", "Test User") if request.userInfo else "Test User",
                     avatar_url=request.userInfo.get("avatarUrl", "") if request.userInfo else ""
                 )
                 session.add(user)
                 session.commit()
             return {"openid": mock_openid, "session_key": "mock_session_key"}

        raise HTTPException(status_code=500, detail="WeChat credentials not configured")

    url = f"https://api.weixin.qq.com/sns/jscode2session?appid={WECHAT_APP_ID}&secret={WECHAT_APP_SECRET}&js_code={request.code}&grant_type=authorization_code"
    
    async with httpx.AsyncClient() as client:
        resp = await client.get(url)
        data = resp.json()
        
    if "errcode" in data and data["errcode"] != 0:
        raise HTTPException(status_code=400, detail=f"WeChat Login Failed: {data.get('errmsg')}")
        
    openid = data["openid"]
    session_key = data["session_key"]
    
    # Check if user exists
    user = session.get(User, openid)
    if not user:
        # Create new user
        # Note: newer WeChat APIs don't give userInfo automatically on login. 
        # The frontend needs to send it or we create a placeholder.
        nickname = "微信用户"
        avatar_url = ""
        if request.userInfo:
            nickname = request.userInfo.get("nickName", "微信用户")
            avatar_url = request.userInfo.get("avatarUrl", "")
            
        user = User(openid=openid, nickname=nickname, avatar_url=avatar_url)
        session.add(user)
        session.commit()
    else:
        # Update user info if provided
        if request.userInfo:
            user.nickname = request.userInfo.get("nickName", user.nickname)
            user.avatar_url = request.userInfo.get("avatarUrl", user.avatar_url)
            session.add(user)
            session.commit()
            
    return {"openid": openid, "session_key": session_key}


@app.get("/generate_story")
async def generate_story(
    words: List[str] = Query(None),
    topic: str = "Daily Life",
    level: str = "Junior High",
    stream: bool = False
):
    request_id = f"req_{int(time.time()*1000)}"
    logger.info(f"[{request_id}] Generating story for topic='{topic}', level='{level}', stream={stream}")
    
    if not words:
        # If no words provided, pick random ones (simple fallback logic or error)
        # For now, we expect words to be passed. If not, error.
        raise HTTPException(status_code=400, detail="Words list is required")

    words_str = ", ".join(words)
    
    # Prompt construction
    difficulty_desc = ""
    length_instruction = ""
    quiz_instruction = ""
    
    if level == "KET":
        difficulty_desc = "CEFR A2. Use simple sentences and basic connectors (and, but, because)."
        length_instruction = "Write a short story, around 80-120 words. Around 5-10 sentences."
        quiz_instruction = "Create 3 simple multiple-choice questions."
    elif level == "PET":
        difficulty_desc = "CEFR B1. Use standard grammar, some compound sentences. Moderate vocabulary."
        length_instruction = "Write a story around 120-150 words. Around 10-15 sentences."
        quiz_instruction = "Create 3 moderate multiple-choice questions."
    elif level == "Junior High":
        difficulty_desc = "CEFR B1/B2. Use varied sentence structures. Standard textbook vocabulary."
        length_instruction = "Write a story around 120-150 words. Around 10-15 sentences."
        quiz_instruction = "Create 3 standard multiple-choice questions."
    elif level == "Senior High":
        difficulty_desc = (
            "CEFR B2 (Senior High School). "
            "Use complex grammar: passive voice, conditionals (if...), and participial phrases. "
            "Story style: News article or formal essay."
        )
        length_instruction = "Write a longer story, around 180-220 words. Around 20 sentences."
        quiz_instruction = "Create 3 challenging multiple-choice questions. Focus on inference, synonym matching, and context clues. Options should be slightly ambiguous to test precision."
    elif level == "Postgraduate":
        difficulty_desc = (
            "CEFR C1/C2 (Advanced/Academic). "
            "Use highly sophisticated grammar: inversion, subjunctive mood, and long compound-complex sentences. "
            "Story style: Academic paper, classic literature, or The Economist."
        )
        length_instruction = "Write a comprehensive story, at least 250 words. Around 25 sentences with deep context."
        quiz_instruction = "Create 3 advanced multiple-choice questions. Focus on deep reading comprehension, tone analysis, and nuanced vocabulary usage. Options should be complex and require critical thinking."
    else:
        # Default fallback (including Primary School if sent)
        difficulty_desc = "Intermediate level (CEFR B1). Use standard vocabulary and sentence structures."
        length_instruction = "Keep the story moderate length, around 10-15 sentences."
        quiz_instruction = "Create 3 standard multiple-choice questions testing comprehension."

    # Adjust Topic context based on Level to avoid mismatch (e.g., "Postgraduate" + "Daily Life" should be "Sociological analysis of daily life")
    topic_context = topic
    if level in ["Senior High", "Postgraduate"] and topic == "Daily Life":
        topic_context = "Sociological or Psychological analysis of modern daily routines"
    if level == "Primary School" and topic == "Science":
        topic_context = "Simple science fun facts (e.g. why sky is blue)"

    prompt = f"""
    You are an expert English teacher creating reading materials for students.
    
    TASK: Write a story using these words: {words_str}.
    
    CONSTRAINTS (MUST FOLLOW):
    1. LEVEL: {difficulty_desc}
    2. LENGTH: {length_instruction}
    3. TOPIC: {topic_context}
    
    IMPORTANT: The LEVEL and LENGTH constraints are STRICT. Adapt the Topic to fit the Level.
    - If Level is KET/Elementary, ignore complex topic details. Focus ONLY on simple actions and objects.
    - Do NOT write a long story if the length instruction says "short".
    - Do NOT exceed the word count limit.
    
    Highlight the target words in Markdown bold (**word**).
    
    ALSO, generate 3 multiple-choice questions to test the user's understanding of the vocabulary words in the context of the story. 
    QUIZ DIFFICULTY: {quiz_instruction}
    The questions and options must be in English.
    
    The output must be a valid JSON object with the following structure:
    {{
        "content": "The story content in markdown...",
        "translation": "The full chinese translation of the story...",
        "translation_map": {{
            "word1": "chinese_translation1",
            "word2": "chinese_translation2"
        }},
        "quiz": [
            {{
                "question": "Question text here?",
                "options": ["Option A", "Option B", "Option C", "Option D"],
                "answer": "Option A"
            }}
        ]
    }}
    Ensure the JSON is valid. Do not include markdown formatting (```json) around the JSON output, just the raw JSON string.
    """
    
    if stream:
        async def generate_stream():
            try:
                # No retry logic for stream yet, as it complicates the generator. 
                # Rely on client reconnection or simple fail.
                logger.info(f"[{request_id}] Starting Stream API call...")
                response = client.chat.completions.create(
                    model=MODEL,
                    messages=[
                        {"role": "system", "content": "You are a helpful assistant that outputs raw JSON without markdown formatting."},
                        {"role": "user", "content": prompt}
                    ],
                    response_format={"type": "json_object"},
                    stream=True
                )
                for chunk in response:
                    if chunk.choices[0].delta.content:
                        yield chunk.choices[0].delta.content
                logger.info(f"[{request_id}] Stream finished.")
            except Exception as e:
                logger.error(f"[{request_id}] Stream Error: {str(e)}")
                # In a stream, we can't easily change status code once started, 
                # but we can yield an error message if the client expects it, 
                # or just close the stream.
                yield "" 

        return StreamingResponse(generate_stream(), media_type="text/event-stream")

    # Non-streaming logic (keep existing retry logic)
    try:
        start_time = time.time()
        logger.info(f"[{request_id}] Calling SiliconFlow API (Model: {MODEL})...")
        
        # Retry logic
        max_retries = 3
        retry_delay = 2 # seconds
        content = ""
        
        for attempt in range(max_retries):
            try:
                response = client.chat.completions.create(
                    model=MODEL,
                    messages=[
                        {"role": "system", "content": "You are a helpful assistant that outputs raw JSON without markdown formatting."},
                        {"role": "user", "content": prompt}
                    ],
                    response_format={"type": "json_object"}
                )
                content = response.choices[0].message.content
                logger.info(f"[{request_id}] API call successful (Attempt {attempt+1}).")
                break
            except Exception as api_err:
                logger.warning(f"[{request_id}] API Attempt {attempt+1} failed: {str(api_err)}")
                if attempt < max_retries - 1:
                    time.sleep(retry_delay)
                else:
                    raise api_err

        duration = time.time() - start_time
        logger.info(f"[{request_id}] Total duration: {duration:.2f}s")
        logger.info(f"[{request_id}] Response content length: {len(content)}")
        
        return json.loads(content)
    except json.JSONDecodeError as je:
        logger.error(f"[{request_id}] JSON Parse Error: {str(je)}")
        logger.error(f"[{request_id}] Raw content: {content[:500]}...") # Log first 500 chars
        # Fallback or Error
        raise HTTPException(status_code=500, detail="Failed to parse AI response")
    except Exception as e:
        logger.error(f"[{request_id}] Unexpected Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/audio")
async def get_audio(text: str):
    """
    Generates audio from text using edge-tts.
    Returns a streaming response of the audio data.
    """
    if not text:
        raise HTTPException(status_code=400, detail="Text is required")

    voice = "en-US-AriaNeural"
    communicate = edge_tts.Communicate(text, voice)
    
    async def audio_stream():
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                yield chunk["data"]
                
    return StreamingResponse(audio_stream(), media_type="audio/mpeg")

@app.post("/chat")
def chat(request: ChatRequest):
    if not SILICONFLOW_API_KEY:
        raise HTTPException(status_code=500, detail="SILICONFLOW_API_KEY not set in environment variables.")

    system_prompt = f"""
    You are a character from the generated story.
    
    STORY CONTEXT:
    {request.story_context}
    
    TARGET WORDS:
    {", ".join(request.target_words)}
    
    INSTRUCTIONS:
    1. Roleplay as a character from the story.
    2. Interact with the user.
    3. Encourage the user to use the target words in their replies.
    4. If the user uses a target word correctly, praise them briefly.
    5. Keep your responses concise (under 50 words) and conversational.
    6. If the user speaks Chinese, reply in simple English and explain if needed.
    """
    
    # Prepare messages for the API
    # We include the system prompt and the recent chat history provided by the frontend
    messages = [{"role": "system", "content": system_prompt}] + request.messages
    
    try:
        response = client.chat.completions.create(
            model=MODEL,
            messages=messages
        )
        return {"response": response.choices[0].message.content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class SubmitQuizRequest(BaseModel):
    user_name: Optional[str] = None
    openid: Optional[str] = None
    topic: str
    level: str
    score: int

@app.post("/submit_quiz")
def submit_quiz(request: SubmitQuizRequest, session: Session = Depends(get_session)):
    try:
        final_user_name = request.user_name or "Unknown User"
        if request.openid:
            user = session.get(User, request.openid)
            if user:
                final_user_name = user.nickname
        
        record = QuizHistory(
            user_name=final_user_name, # Storing openid actually based on db.py comment, but let's stick to openid if available
            topic=request.topic,
            level=request.level,
            score=request.score
        )
        session.add(record)
        session.commit()
        return {"status": "success", "score": request.score}
    except Exception as e:
        logger.error(f"Submit Quiz Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/quiz_history")
def get_quiz_history(openid: str, session: Session = Depends(get_session)):
    statement = select(QuizHistory).where(QuizHistory.user_name == openid).order_by(QuizHistory.created_at.desc())
    results = session.exec(statement).all()
    return results

@app.get("/leaderboard")
def get_leaderboard_data(type: str = "total", session: Session = Depends(get_session)):
    """
    Get leaderboard data.
    type: 'total', 'weekly', 'daily'
    """
    # SQLite doesn't have great date functions in SQLModel direct queries easily without raw SQL or client side processing for MVP
    # For MVP, let's fetch all and aggregate in python (not efficient for million users but fine for demo)
    
    all_records = session.exec(select(QuizHistory)).all()
    
    scores = {} # openid -> {score: 0, nickname: ''}
    
    now = datetime.now()
    
    for r in all_records:
        r_time = datetime.fromisoformat(r.created_at)
        
        include = False
        if type == 'total':
            include = True
        elif type == 'weekly':
            if now - r_time < timedelta(days=7):
                include = True
        elif type == 'daily':
            if now - r_time < timedelta(days=1):
                include = True
                
        if include:
            if r.user_name not in scores:
                # Try to get nickname from User table if possible, or just use ID for now
                scores[r.user_name] = 0
            scores[r.user_name] += r.score
            
    # Convert to list
    leaderboard = []
    for openid, score in scores.items():
        # Fetch nickname
        user = session.get(User, openid)
        nickname = user.nickname if user else "User " + openid[-4:]
        leaderboard.append({"username": nickname, "score": score, "rank": 0})
        
    # Sort
    leaderboard.sort(key=lambda x: x['score'], reverse=True)
    
    # Add rank
    for i, item in enumerate(leaderboard):
        item['rank'] = i + 1
        
    return leaderboard[:20] # Top 20

@app.post("/record_learning")
def record_learning(request: RecordLearningRequest, session: Session = Depends(get_session)):
    try:
        # Resolve user_name
        final_user_name = request.user_name
        final_openid = request.openid
        
        if final_openid:
            user = session.get(User, final_openid)
            if user:
                final_user_name = user.nickname
            elif not final_user_name:
                final_user_name = "Unknown User"
        elif not final_user_name:
             raise HTTPException(status_code=400, detail="Either openid or user_name is required")

        for item in request.words:
            word = item.get("word")
            meaning = item.get("meaning")
            
            record = LearningRecord(
                user_name=final_user_name,
                openid=final_openid,
                word=word,
                meaning=meaning,
                source_level=request.source_level,
                topic=request.topic,
                created_at=datetime.now().isoformat()
            )
            session.add(record)
        
        session.commit()
        return {"status": "success", "count": len(request.words)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/learning_history")
def get_learning_history(
    user_name: Optional[str] = None, 
    openid: Optional[str] = None,
    session: Session = Depends(get_session)
):
    if openid:
        statement = select(LearningRecord).where(LearningRecord.openid == openid).order_by(LearningRecord.created_at.desc())
    elif user_name:
        statement = select(LearningRecord).where(LearningRecord.user_name == user_name).order_by(LearningRecord.created_at.desc())
    else:
        raise HTTPException(status_code=400, detail="Either openid or user_name is required")
        
    results = session.exec(statement).all()
    return results

@app.get("/leaderboard_legacy")
def get_leaderboard_legacy(type: str = "total", session: Session = Depends(get_session)):
    """
    Get leaderboard data.
    type: "daily", "weekly", "total"
    """
    now = datetime.now()
    
    # We want to group by openid if possible, falling back to user_name for legacy records
    # But for simplicity, since we populate user_name even for openid users, we can group by user_name
    # Or better: group by openid for users who have it, and user_name for those who don't?
    # Simplest approach for transition: Group by user_name (since we ensure user_name is set for openid users too)
    
    query = select(LearningRecord.user_name, func.count(LearningRecord.id).label("count"))
    
    if type == "daily":
        start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
        query = query.where(LearningRecord.created_at >= start_of_day.isoformat())
    elif type == "weekly":
        # Start of week (Monday)
        start_of_week = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        query = query.where(LearningRecord.created_at >= start_of_week.isoformat())
    
    query = query.group_by(LearningRecord.user_name).order_by(desc("count"))
    
    results = session.exec(query).all()
    
    # Format results
    leaderboard = []
    for user_name, count in results:
        # Try to find user info to get avatar (optional enhancement)
        # For now just return name and count
        leaderboard.append({"user_name": user_name, "count": count})
        
    return leaderboard

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
