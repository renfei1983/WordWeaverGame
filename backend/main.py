import os
import logging
import edge_tts
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pathlib import Path
from dotenv import load_dotenv

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

app = FastAPI(title="WordWeaver TTS Backend")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    logger.info("Health check endpoint called")
    return {"message": "WordWeaver TTS Backend is running", "version": "1.0.0"}

@app.get("/audio")
async def text_to_speech(text: str = Query(..., max_length=5000), voice: str = "en-US-ChristopherNeural"):
    """
    Generate TTS audio using edge-tts (Microsoft Edge TTS).
    Returns binary audio data directly.
    """
    logger.info(f"Generating audio for text: {text[:50]}...")
    
    try:
        communicate = edge_tts.Communicate(text, voice)
        
        # Generator to stream audio chunks
        async def audio_generator():
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    yield chunk["data"]
                    
        return StreamingResponse(audio_generator(), media_type="audio/mpeg")
    
    except Exception as e:
        logger.error(f"TTS Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
