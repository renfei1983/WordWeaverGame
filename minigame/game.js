const { vocabularyDict } = require('./vocabulary.js')

// --- Polyfills (MUST BE FIRST) ---
if (typeof setTimeout === 'undefined') {
  const polyfill = function(callback, delay) {
    const start = Date.now()
    const loop = () => {
      if (Date.now() - start >= delay) {
        callback()
      } else {
        requestAnimationFrame(loop)
      }
    }
    requestAnimationFrame(loop)
    return 0
  }
  
  if (typeof GameGlobal !== 'undefined') {
    GameGlobal.setTimeout = polyfill
    GameGlobal.clearTimeout = function() {}
  }
  if (typeof window !== 'undefined') {
    window.setTimeout = polyfill
    window.clearTimeout = function() {}
  }
}

// --- Global Audio Config (iOS Fix) ---
if (wx.setInnerAudioOption) {
  wx.setInnerAudioOption({
    obeyMuteSwitch: false,
    speakerOn: true,
    success: () => console.log('Global Audio Option: Mute Disabled'),
    fail: (e) => console.warn('Global Audio Option Failed (Expected on DevTools)', e)
  })
}

// Helper for UTF-8 decoding
function utf8Decode(uint8array) {
  try {
     return new TextDecoder("utf-8").decode(uint8array)
  } catch(e) {
     let out = "";
     let i = 0;
     while(i < uint8array.length) {
       let c = uint8array[i++];
       if (c >> 7 == 0) {
         out += String.fromCharCode(c);
       } else if ((c & 0xFC) == 0xC0) {
         out += String.fromCharCode(((c & 0x1F) << 6) | (uint8array[i++] & 0x3F));
       } else if ((c & 0xF0) == 0xE0) {
         out += String.fromCharCode(((c & 0x0F) << 12) | ((uint8array[i++] & 0x3F) << 6) | (uint8array[i++] & 0x3F));
       } else {
         i += 3; 
       }
     }
     return out;
  }
}

const canvas = wx.createCanvas()
const context = canvas.getContext('2d')

// Ensure timers are available in local scope
const setTimeout = GameGlobal.setTimeout || window.setTimeout || function(cb, ms) { cb() }
const clearTimeout = GameGlobal.clearTimeout || window.clearTimeout || function() {}
const setInterval = GameGlobal.setInterval || window.setInterval || function(cb, ms) { return 0 }
const clearInterval = GameGlobal.clearInterval || window.clearInterval || function() {}

// --- Configuration ---
const CLOUD_ENV = 'cloudbase-1g6a925fc4f71607'
const USE_CLOUD = true
const USE_STREAM = true // Enable streaming
const USE_NATIVE_AI = true // Use WeChat Cloud Native AI (Hunyuan)
// TODO: Replace with your Cloud Container Public Domain (e.g. https://flask-service-xxx.sh.run.tcloudbase.com)
// The previous API Gateway URL (https://flask-service-r4324.gz.apigw.tencentcs.com/release) may not support streaming.
const CLOUD_API_URL = 'https://flask-service-r4324.gz.apigw.tencentcs.com/release' 
const BACKEND_VERSION = 'v1.9.0'

// --- Constants ---
const LEVELS = ['KET', 'PET', 'Junior High', 'Senior High', 'Postgraduate']
const TOPICS = ['Daily Life', 'Science', 'Art', 'Harry Potter', 'Avengers', 'Minecraft']

// --- Theme Configuration (Modern Minimalism - Revamped) ---
const Theme = {
  bg: '#F7F8FA',       // Very Light Blue-Grey (Global)
  surface: '#FFFFFF',  // Pure White (Cards/Surface)
  primary: '#3B82F6',  // Vivid Blue (Primary Action)
  primaryTxt: '#FFFFFF', // Text on Primary
  secondary: '#F3F4F6', // Very Light Gray (Secondary Action/Options)
  secondaryTxt: '#374151', // Dark Gray (Text on Secondary)
  textMain: '#111827', // Almost Black (Headings - Sharp)
  textSub: '#6B7280',  // Medium Gray (Subtext)
  textLight: '#9CA3AF', // Lighter Gray (Auxiliary)
  accent: '#10B981',   // Emerald Green (Success)
  error: '#EF4444',    // Red (Error)
  border: '#E5E7EB',   // Gray Border
  shadow: 'rgba(0, 0, 0, 0.08)' // Soft, modern shadow
}

// --- System Info & Layout ---
const sysInfo = wx.getSystemInfoSync()
const safeAreaTop = sysInfo.statusBarHeight || 20
const headerHeight = 60 // Increased for better touch target and spacing
const tabBarHeight = 60 // Increased for easier clicking
const audioPlayerHeight = 90
const contentTop = safeAreaTop + headerHeight + tabBarHeight + 30 // Matches contentY (header+10 + tab+20) in Game Scene
const hubContentTop = safeAreaTop + headerHeight + tabBarHeight // Matches contentY in Hub Scene

// --- State Management ---
let user = null
let isLogin = false
let currentScene = 'hub' // 'hub', 'wordweaver', 'game'
let isWarmingUp = false

let isHubLoading = false
let isSubmitting = false

// Hub State (WordWeaver 3 Cards)
let hubTab = 'SELECTION' // 'SELECTION', 'HISTORY', 'RANK'
let selectedLevel = 'Junior High'
let selectedTopic = 'Daily Life'
let historyData = []
let leaderboardData = []
let rankType = 'total' // 'daily', 'weekly', 'total'

// Game State
let gameState = 'INIT' // INIT, LOADING, READY, ERROR
let storyData = null
let currentTab = 'STORY' // STORY, WORDS, TRANSLATION, QUIZ
let showTranslation = false

// Quiz State
let quizIndex = 0
let score = 0 // Local feedback score (10 pts/question)
let correctCount = 0 // Track number of correct answers
let quizSelectedOption = null
let quizAnswered = false

// Scroll State
let scrollOffset = 0
let contentHeight = 0
let touchStartY = 0
let isDragging = false

// Audio State
let audioCtx = null
let isAudioPlaying = false
let audioProgress = 0
let audioDuration = 0
let currentAudioSrc = ''

function initAudio() {
  if (audioCtx) audioCtx.destroy()
  audioCtx = wx.createInnerAudioContext()
  audioCtx.obeyMuteSwitch = false
  audioCtx.volume = 1.0
  
  audioCtx.onPlay(() => {
    isAudioPlaying = true
    draw()
  })
  
  audioCtx.onPause(() => {
    isAudioPlaying = false
    draw()
  })
  
  audioCtx.onEnded(() => {
    isAudioPlaying = false
    audioProgress = 0
    draw()
  })
  
  audioCtx.onTimeUpdate(() => {
    if (audioCtx.duration > 0) {
      audioProgress = audioCtx.currentTime / audioCtx.duration
      audioDuration = audioCtx.duration
      if (currentScene === 'game' && currentTab === 'STORY') {
        draw()
      }
    }
  })
  
  audioCtx.onError((res) => {
    console.error('Audio Error:', res)
    isAudioPlaying = false
    wx.showToast({ title: '播放出错', icon: 'none' })
    draw()
  })
}

initAudio()

// --- Initialization ---
if (USE_CLOUD) {
  wx.cloud.init({ env: CLOUD_ENV, traceUser: true })
  warmupBackend()
}

// Inputs
let currentWords = []
let activeButtons = [] // {x, y, w, h, callback, id}

function warmupBackend() {
  if (isWarmingUp) return
  isWarmingUp = true
  
  if (USE_CLOUD && wx.cloud) {
      // Warm up the cloud function
      wx.cloud.callFunction({
          name: 'wordweaver',
          data: { action: 'login' }
      }).then(() => {
          console.log('Cloud Function Warmed Up')
      }).catch(e => {
          // Ignore errors during warmup
      })
  }
}

function callApi(path, method, data, success, fail) {
  let finalPath = path
  let finalData = data

  if (method === 'GET' && data) {
    const params = []
    Object.keys(data).forEach(key => {
      const val = data[key]
      if (Array.isArray(val)) {
        val.forEach(v => params.push(`${key}=${encodeURIComponent(v)}`))
      } else {
        params.push(`${key}=${encodeURIComponent(val)}`)
      }
    })
    if (params.length > 0) {
      finalPath += (finalPath.includes('?') ? '&' : '?') + params.join('&')
    }
    finalData = {}
  }

  if (USE_CLOUD) {
    wx.cloud.callContainer({
      config: { env: CLOUD_ENV },
      path: finalPath,
      header: {
        'X-WX-SERVICE': 'flask-service',
        'content-type': 'application/json'
      },
      method: method,
      data: finalData,
      timeout: 120000,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          success({ data: res.data, statusCode: res.statusCode })
        } else {
          if (fail) fail(res)
        }
      },
      fail: (err) => {
        if (fail) fail(err)
      }
    })
  } else {
    wx.request({
      url: `http://localhost:8000${finalPath}`,
      method: method,
      data: finalData,
      success: success,
      fail: fail
    })
  }
}

function buildStoryPrompt(words, level, topic) {
  const words_str = words.join(", ")
  
  let difficulty_desc = ""
  let length_instruction = ""
  let quiz_instruction = ""
  
  if (level === "KET") {
      difficulty_desc = "CEFR A2. Use simple sentences and basic connectors (and, but, because)."
      length_instruction = "Write a short story, around 80-120 words. Around 5-10 sentences."
      quiz_instruction = "Create 3 simple multiple-choice questions."
  } else if (level === "PET") {
      difficulty_desc = "CEFR B1. Use standard grammar, some compound sentences. Moderate vocabulary."
      length_instruction = "Write a story around 120-150 words. Around 10-15 sentences."
      quiz_instruction = "Create 3 moderate multiple-choice questions."
  } else if (level === "Junior High") {
      difficulty_desc = "CEFR B1/B2. Use varied sentence structures. Standard textbook vocabulary."
      length_instruction = "Write a story around 120-150 words. Around 10-15 sentences."
      quiz_instruction = "Create 3 standard multiple-choice questions."
  } else if (level === "Senior High") {
      difficulty_desc = "CEFR B2 (Senior High School). Use complex grammar: passive voice, conditionals (if...), and participial phrases. Story style: News article or formal essay."
      length_instruction = "Write a longer story, around 180-220 words. Around 20 sentences."
      quiz_instruction = "Create 3 challenging multiple-choice questions. Focus on inference, synonym matching, and context clues. Options should be slightly ambiguous to test precision."
  } else if (level === "Postgraduate") {
      difficulty_desc = "CEFR C1/C2 (Advanced/Academic). Use highly sophisticated grammar: inversion, subjunctive mood, and long compound-complex sentences. Story style: Academic paper, classic literature, or The Economist."
      length_instruction = "Write a comprehensive story, at least 250 words. Around 25 sentences with deep context."
      quiz_instruction = "Create 3 advanced multiple-choice questions. Focus on deep reading comprehension, tone analysis, and nuanced vocabulary usage. Options should be complex and require critical thinking."
  } else {
      difficulty_desc = "Intermediate level (CEFR B1). Use standard vocabulary and sentence structures."
      length_instruction = "Keep the story moderate length, around 10-15 sentences."
      quiz_instruction = "Create 3 standard multiple-choice questions testing comprehension."
  }

  let topic_context = topic
  if ((level === "Senior High" || level === "Postgraduate") && topic === "Daily Life") {
      topic_context = "Sociological or Psychological analysis of modern daily routines"
  }

  return `
    You are an expert English teacher creating reading materials for students.
    
    TASK: Write a story using these words: ${words_str}.
    
    CONSTRAINTS (MUST FOLLOW):
    1. LEVEL: ${difficulty_desc}
    2. LENGTH: ${length_instruction}
    3. TOPIC: ${topic_context}
    
    IMPORTANT: The LEVEL and LENGTH constraints are STRICT. Adapt the Topic to fit the Level.
    - If Level is KET/Elementary, ignore complex topic details. Focus ONLY on simple actions and objects.
    - Do NOT write a long story if the length instruction says "short".
    - Do NOT exceed the word count limit.
    
    Highlight the target words in Markdown bold (**word**).
    
    ALSO, generate 3 multiple-choice questions to test the user's understanding of the vocabulary words in the context of the story. 
    QUIZ DIFFICULTY: ${quiz_instruction}
    The questions and options must be in English.
    
    The output must be a valid JSON object with the following structure:
    {
        "content": "The story content in markdown...",
        "translation": "The full chinese translation of the story...",
        "translation_map": {
            "word1": "chinese_translation1",
            "word2": "chinese_translation2"
        },
        "quiz": [
            {
                "question": "Question text here?",
                "options": ["Option A", "Option B", "Option C", "Option D"],
                "answer": "Option A"
            }
        ]
    }
    Ensure the JSON is valid. Do not include markdown formatting (\`\`\`json) around the JSON output, just the raw JSON string.
  `
}

function callApiStream(path, method, data, onChunk, onSuccess, onFail) {
    // --- Option 1: Native AI (Hunyuan) ---
    if (USE_NATIVE_AI && path === '/generate_story') {
        console.log('Using Native Hunyuan AI...')
        const prompt = buildStoryPrompt(data.words, data.level, data.topic)
        
        // Ensure wx.cloud.extend.AI is available
        if (!wx.cloud || !wx.cloud.extend || !wx.cloud.extend.AI) {
             console.error('wx.cloud.extend.AI not available. Check project config.')
             if (onFail) onFail(new Error('Native AI not available'))
             return
        }

        // --- Step 1: Get Available Models (Dynamic) ---
        ;(async () => {
            try {
                // 1. Get and print available models
                let modelId = "hunyuan-lite" // Default fallback
                if (wx.cloud.extend.AI.getModels) {
                    try {
                        const models = await wx.cloud.extend.AI.getModels()
                        console.log('Available AI Models:', models)
                        // If we find a suitable model in the list, we could use it
                        // For now, we trust the user provided "hunyuan-exp" or "hunyuan-lite"
                        if (models && models.length > 0) {
                             const found = models.find(m => m.id === 'hunyuan-lite' || m.id === 'hunyuan-exp')
                             if (found) modelId = found.id
                        }
                    } catch (e) {
                        console.warn('getModels failed:', e)
                    }
                }

                console.log('Using Model ID:', modelId)

                // 2. Create Model Instance
                // Use the user-suggested "hunyuan-exp" or fallback to "hunyuan"
                const ai = wx.cloud.extend.AI.createModel("hunyuan") 

                // 3. Call streamText with new interface (Async Iterable)
                const res = await ai.streamText({
                    data: {
                        model: modelId, 
                        messages: [
                            { role: "system", content: "You are a helpful assistant that outputs raw JSON without markdown formatting." },
                            { role: "user", content: prompt }
                        ]
                    }
                })

                // 4. Handle Stream
                if (res.eventStream) {
                    for await (const event of res.eventStream) {
                        if (event.data === "[DONE]") {
                            break
                        }
                        try {
                            const data = JSON.parse(event.data)
                            // Standard OpenAI-like format: choices[0].delta.content
                            const text = data?.choices?.[0]?.delta?.content
                            if (text) {
                                onChunk(text)
                            }
                        } catch (e) {
                            // If not JSON, maybe raw text?
                            // console.warn('Parse chunk failed:', e, event.data)
                        }
                    }
                }

                console.log('AI Generation Finished')
                if (onSuccess) onSuccess()

            } catch (err) {
                console.error('Hunyuan AI Exception:', err)
                wx.showModal({
                    title: 'AI 服务错误',
                    content: '无法连接到智能模型: ' + (err.message || JSON.stringify(err)),
                    showCancel: false
                })
                if (onFail) onFail(err)
            }
        })()
        
        return
    }

    // --- Option 2/Fallback: Cloud Container / Local ---
    let finalPath = path
    if (method === 'GET' && data) {
        const params = []
        Object.keys(data).forEach(key => {
            const val = data[key]
            if (Array.isArray(val)) {
                val.forEach(v => params.push(`${key}=${encodeURIComponent(v)}`))
            } else {
                params.push(`${key}=${encodeURIComponent(val)}`)
            }
        })
        if (params.length > 0) {
            finalPath += (finalPath.includes('?') ? '&' : '?') + params.join('&')
        }
    }

    // Force append stream=true
    finalPath += (finalPath.includes('?') ? '&' : '?') + 'stream=true'

    // If streaming disabled, fallback immediately
    if (!USE_STREAM) {
         console.log('Streaming disabled, using fallback API...')
         callApi(path, method, data, (res) => {
            console.log('Fallback success', res)
            const jsonStr = JSON.stringify(res.data)
            if (onChunk) onChunk(jsonStr)
            if (onSuccess) onSuccess()
        }, (err) => {
            console.error('Fallback failed', err)
            if (onFail) onFail(err)
        })
        return
    }

    const url = USE_CLOUD 
        ? `${CLOUD_API_URL}${finalPath}` 
        : `http://localhost:8000${finalPath}`

    console.log('Starting Stream Request:', url)
    const requestTask = wx.request({
        url: url,
        method: method,
        enableChunked: true,
        header: {
            'content-type': 'application/json'
        },
        success: (res) => {
            console.log('Stream request finished', res)
            if (onSuccess) onSuccess() 
        },
        fail: (err) => {
            console.error('Stream request failed', err)
            
            // Fallback to non-streaming API (Cloud Function)
            console.log('Falling back to non-streaming API...')
            // Remove stream parameter from path/data if present
            // But callApi handles params itself.
            // We reuse the original path and data.
            
            callApi(path, method, data, (res) => {
                // Success from non-streaming
                // res is the full response object
                console.log('Fallback success', res)
                
                // Simulate streaming by sending full JSON string as one chunk
                const jsonStr = JSON.stringify(res.data)
                if (onChunk) onChunk(jsonStr)
                if (onSuccess) onSuccess()
            }, (err2) => {
                console.error('Fallback failed', err2)
                if (onFail) onFail(err2)
            })
        }
    })
    requestTask.onChunkReceived((res) => {
        const arrayBuffer = res.data
        const uint8Array = new Uint8Array(arrayBuffer)
        const text = utf8Decode(uint8Array)
        if (onChunk) onChunk(text)
    })
}

function login() {
  wx.showLoading({ title: '登录中...' })
  
  const onLoginFail = (err) => {
      wx.hideLoading()
      console.warn('Cloud login failed, using Guest Mode', err)
      user = { openid: 'guest_' + Math.random().toString(36).substr(2, 9) }
      isLogin = true
      wx.setStorageSync('user', user)
      draw()
      wx.showToast({ title: '访客模式', icon: 'none' })
  }

  // Use Cloud Function for Login
  if (USE_CLOUD && wx.cloud) {
      wx.cloud.callFunction({
          name: 'wordweaver',
          data: { action: 'login' }
      }).then(res => {
          wx.hideLoading()
          if (res.result && res.result.openid) {
              const { openid } = res.result
              user = { openid }
              isLogin = true
              wx.setStorageSync('user', user)
              draw()
              wx.showToast({ title: '登录成功' })
          } else {
              onLoginFail('No openid returned')
          }
      }).catch(err => {
          onLoginFail(err)
      })
  } else {
      // Fallback for non-cloud (should not happen in this version but safe to keep)
      onLoginFail('Cloud not enabled')
  }
}

const storedUser = wx.getStorageSync('user')
if (storedUser) {
  user = storedUser
  isLogin = true
} else {
  login()
}

// --- Data Fetching ---
function fetchHistory() {
  if (!user || !user.openid) return
  isHubLoading = true
  draw()
  
  // Use Cloud Function
  if (USE_CLOUD && wx.cloud) {
      wx.cloud.callFunction({
          name: 'wordweaver',
          data: { action: 'get_history' }
      }).then(res => {
          historyData = (res.result && res.result.data) ? res.result.data : []
          isHubLoading = false
          draw()
      }).catch(err => {
          console.error(err)
          isHubLoading = false
          draw()
      })
  } else {
      isHubLoading = false
      draw()
  }
}

function fetchLeaderboard() {
  isHubLoading = true
  draw()
  
  // Use Cloud Function
  if (USE_CLOUD && wx.cloud) {
      wx.cloud.callFunction({
          name: 'wordweaver',
          data: { action: 'get_leaderboard' }
      }).then(res => {
          leaderboardData = (res.result && res.result.data) ? res.result.data : []
          isHubLoading = false
          draw()
      }).catch(err => {
          console.error(err)
          isHubLoading = false
          draw()
      })
  } else {
      isHubLoading = false
      draw()
  }
}

// --- Game Logic ---

let storyBuffer = [] // Cache for pre-generated stories
let isPrefetching = false

function pickRandomWords(count = 5) {
  const list = vocabularyDict[selectedLevel] || vocabularyDict['Junior High'] || []
  const shuffled = [...list].sort(() => 0.5 - Math.random())
  return shuffled.slice(0, count)
}

function prefetchStory(onProgress) {
    if (storyBuffer.length >= 3 || isPrefetching) return

    isPrefetching = true
    const words = pickRandomWords(5)
    
    // Capture current settings to verify consistency later
    const requestedTopic = selectedTopic
    const requestedLevel = selectedLevel

    console.log('Prefetching story (Stream)...', requestedTopic, requestedLevel)
    
    let accumulatedJSON = ""
    
    callApiStream('/generate_story', 'GET', {
        words: words,
        topic: requestedTopic,
        level: requestedLevel
    }, (chunk) => {
        // onChunk
        accumulatedJSON += chunk
        if (onProgress) onProgress() 
    }, () => {
        // onSuccess
        // Consistency check: discard if settings changed during fetch
        if (selectedTopic !== requestedTopic || selectedLevel !== requestedLevel) {
            console.log('Discarding prefetched story due to settings change')
            isPrefetching = false
            // Retry with new settings if buffer low
            if (storyBuffer.length < 3) {
                 prefetchStory(onProgress)
            }
            return
        }

        try {
            // Clean markdown code blocks if present
            const cleanJSON = (str) => {
              return str.replace(/```json\s*|\s*```/g, '').trim()
            }
            const data = JSON.parse(cleanJSON(accumulatedJSON))
            if (data && !data.error) {
                storyBuffer.push(data)
                console.log('Story buffered. Current buffer size:', storyBuffer.length)
                
                // If waiting for this story, start game
                if (gameState === 'GENERATING' && storyBuffer.length > 0) {
                     startNewGame()
                }
            }
        } catch (e) {
            console.error('JSON Parse Error', e)
        }

        isPrefetching = false
        // Recursively fill buffer if needed
        if (storyBuffer.length < 3) {
            prefetchStory() // No callback for background fill
        }
    }, (err) => {
        console.error('Prefetch Error', err)
        isPrefetching = false
    })
}

let loadingDots = 0
function drawGenerating(w, h) {
    // Draw simple loading animation
    context.fillStyle = Theme.textMain
    context.font = '20px sans-serif'
    context.textAlign = 'center'
    
    // Update dots
    loadingDots = (loadingDots + 1) % 40
    const dots = '.'.repeat(Math.floor(loadingDots / 10) + 1)
    
    context.fillText('正在生成题目' + dots, w/2, h/2)
    context.fillStyle = Theme.textSub
    context.font = '14px sans-serif'
    context.fillText('DeepSeek 正在思考中...', w/2, h/2 + 30)
}

function startNewGame() {
    if (storyBuffer.length > 0) {
        // Use buffered story
        const data = storyBuffer.shift()
        useStoryData(data)
        // Trigger background prefetch to refill
        prefetchStory()
    } else {
        // No buffer, must wait
        gameState = 'GENERATING'
        currentScene = 'game' // Ensure we are on game scene
        // Start prefetch with progress updates
        prefetchStory(() => {
            // onProgress: trigger redraw to animate dots
            draw()
        })
        draw()
    }
}


function useStoryData(data) {
    storyData = data
    currentWords = [] // Words are embedded in story data usually or we need to track them?
    // Wait, generate_story endpoint uses 'words' param. 
    // The response `storyData` contains the story and quiz.
    // It doesn't strictly return the words list used, but we might need them for UI?
    // Current UI doesn't seem to heavily rely on `currentWords` except for initial generation call.
    // Let's assume `storyData` is enough.
    
    gameState = 'READY'
    quizIndex = 0
    score = 0
    correctCount = 0
    quizSelectedOption = null
    quizAnswered = false
    isSubmitting = false
    currentTab = 'STORY'
    scrollOffset = 0
    isAudioPlaying = false
    audioProgress = 0
    currentAudioSrc = ''
    if (audioCtx) audioCtx.stop()
    draw()
}


function handleAnswer(option) {
  if (quizAnswered) return
  quizSelectedOption = option
  quizAnswered = true
  
  const currentQ = storyData.quiz[quizIndex]
  if (option === currentQ.answer) {
    score += 10
    correctCount++
  }
  draw()
}

function nextQuestion() {
  if (quizIndex < storyData.quiz.length - 1) {
    quizIndex++
    quizSelectedOption = null
    quizAnswered = false
    draw()
  } else {
    finishQuiz()
  }
}

function skipQuestion() {
    // Treat as finished if it's the last one, or just go next
    // User said "Skip this question"
    if (quizIndex < storyData.quiz.length - 1) {
      quizIndex++
      quizSelectedOption = null
      quizAnswered = false
      draw()
    } else {
      finishQuiz()
    }
}

function finishQuiz() {
    if (isSubmitting) return
    isSubmitting = true
    
    let earnedPoints = 0
    let msg = '完成!'
    
    // Only award 5 points if ALL questions are correct (assuming 3 questions usually)
    // Or just if correctCount === totalQuestions
    if (storyData && storyData.quiz && correctCount === storyData.quiz.length) {
        earnedPoints = 5
        msg = '全对! +5积分'
    } else {
        msg = `完成! 答对 ${correctCount}/${storyData.quiz.length} 题`
    }

    saveRecord()
    if (earnedPoints > 0) {
        submitScore(earnedPoints) 
    }
  
    wx.showModal({
        title: '完成',
        content: msg,
        confirmText: '下一关',
        cancelText: '取消',
        success: (res) => {
            isSubmitting = false
            if (res.confirm) {
                startNewGame()
            } else {
                // If cancelled, keep in quiz tab or go back?
                // Usually go back to story or stay.
                // Let's stay for now.
            }
        }
    })
}

function submitScore(points) {
    if (!user || !user.openid) return
    
    // Use Cloud Function
    if (USE_CLOUD && wx.cloud) {
        wx.cloud.callFunction({
            name: 'wordweaver',
            data: { 
                action: 'submit_quiz',
                data: {
                    score: points,
                    level: selectedLevel,
                    topic: selectedTopic,
                    userInfo: user.userInfo || {} // If we had user info
                }
            }
        }).then(res => {
            console.log('Score submitted via Cloud Function')
        }).catch(err => {
            console.error('Score submit failed', err)
        })
    } else {
        // Fallback or ignore
    }
}

function saveRecord() {
  if (!user || !user.openid || !storyData) return
  
  const wordsList = []
  if (storyData.translation_map) {
    Object.keys(storyData.translation_map).forEach(key => {
      wordsList.push({ word: key, meaning: storyData.translation_map[key] })
    })
  }

  callApi('/record_learning', 'POST', {
    user_name: user.openid,
    words: wordsList,
    source_level: selectedLevel,
    topic: selectedTopic
  }, () => {
    console.log('Record saved')
  }, (err) => {
    console.error('Record save failed', err)
  })
}

function toggleAudio() {
  if (isAudioPlaying) {
    audioCtx.pause()
  } else {
    if (currentAudioSrc) {
      audioCtx.play()
    } else {
      fetchAndPlayAudio()
    }
  }
}

function fetchAndPlayAudio() {
  if (!storyData || !storyData.content) return
  
  wx.showLoading({ title: '加载音频...' })
  const text = storyData.content.replace(/\*\*/g, '')
  
  wx.cloud.callContainer({
    config: { env: CLOUD_ENV },
    path: `/audio?text=${encodeURIComponent(text.slice(0, 500))}`,
    method: 'GET',
    header: { 'X-WX-SERVICE': 'flask-service' },
    responseType: 'arraybuffer',
    success: (res) => {
      wx.hideLoading()
      if (res.statusCode === 200 && res.data.byteLength > 0) {
        const fs = wx.getFileSystemManager()
        const timestamp = Date.now()
        const filePath = `${wx.env.USER_DATA_PATH}/story_audio_${timestamp}.mp3`
        try {
          fs.writeFileSync(filePath, res.data)
          currentAudioSrc = filePath
          initAudio()
          audioCtx.src = filePath
          audioCtx.play()
        } catch (e) {
          wx.showToast({ title: '写入失败', icon: 'none' })
        }
      } else {
        wx.showToast({ title: '音频无效', icon: 'none' })
      }
    },
    fail: () => {
      wx.hideLoading()
      wx.showToast({ title: '网络错误', icon: 'none' })
    }
  })
}

// --- Drawing Functions ---

function draw() {
  activeButtons = []
  const { windowWidth, windowHeight } = wx.getSystemInfoSync()
  
  context.fillStyle = Theme.bg
  context.fillRect(0, 0, windowWidth, windowHeight)

  if (currentScene === 'hub') {
    drawMainHub(windowWidth, windowHeight)
  } else if (currentScene === 'wordweaver') {
    drawWordWeaverHub(windowWidth, windowHeight)
  } else {
    drawGameScene(windowWidth, windowHeight)
  }
}

function drawMainHub(w, h) {
  const titleY = safeAreaTop + 80
  context.fillStyle = Theme.primary
  context.font = 'bold 36px sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'top'
  context.fillText('VersaLearn', w / 2, titleY)
  
  context.fillStyle = Theme.textSub
  context.font = '16px sans-serif'
  context.fillText(`Version ${BACKEND_VERSION}`, w / 2, titleY + 50)

  const btnW = w - 60
  const btnH = 90
  const startY = titleY + 140
  
  drawButton(30, startY, btnW, btnH, Theme.primary, 'WordWeaver', '互动故事 & 测验', true, () => {
    if (!isLogin) { login(); return }
    currentScene = 'wordweaver'
    hubTab = 'SELECTION'
    draw()
  }, Theme.primaryTxt, 22)

  drawButton(30, startY + 110, btnW, btnH, Theme.secondary, 'MathMind', '敬请期待', false, null, Theme.secondaryTxt, 22)
}

function drawWordWeaverHub(w, h) {
    // Header
    const headerY = safeAreaTop
    
    context.shadowBlur = 8
    context.shadowColor = Theme.shadow
    context.shadowOffsetY = 2
    context.fillStyle = Theme.surface
    context.fillRect(0, 0, w, safeAreaTop + headerHeight)
    context.shadowBlur = 0
    context.shadowOffsetY = 0
    
    // Back Button
    const backBtnH = 36
    drawButton(10, headerY + (headerHeight - backBtnH)/2, 80, backBtnH, 'transparent', '< 主页', '', true, () => {
        currentScene = 'hub'
        draw()
    }, Theme.primary, 16, true, null, Theme.primary) // Ghost button style

    context.fillStyle = Theme.textMain
    context.font = 'bold 18px sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText('WordWeaver', w / 2, headerY + headerHeight/2)

    // Tabs
    const tabY = safeAreaTop + headerHeight
    const tabs = [
        { key: 'SELECTION', label: '开始' },
        { key: 'HISTORY', label: '历史' },
        { key: 'RANK', label: '排名' }
    ]
    const tabW = w / 3
    
    context.shadowBlur = 8
    context.shadowColor = Theme.shadow
    context.shadowOffsetY = 2
    context.fillStyle = Theme.surface
    context.fillRect(0, tabY, w, tabBarHeight)
    context.shadowBlur = 0
    context.shadowOffsetY = 0
    
    tabs.forEach((tab, i) => {
        const x = i * tabW
        const isActive = hubTab === tab.key
        context.fillStyle = isActive ? Theme.primary : Theme.textSub
        context.font = isActive ? 'bold 16px sans-serif' : '16px sans-serif'
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.fillText(tab.label, x + tabW/2, tabY + tabBarHeight/2)
        
        if (isActive) {
            context.fillStyle = Theme.primary
            // Rounded indicator
            const indW = 20
            const indH = 3
            drawRoundedRect(context, x + tabW/2 - indW/2, tabY + tabBarHeight - 4, indW, indH, 1.5, true, false)
        }
        
        // Expanded touch area
        activeButtons.push({
            x: x, y: tabY, w: tabW, h: tabBarHeight,
            callback: () => {
                hubTab = tab.key
                scrollOffset = 0
                if (hubTab === 'HISTORY') fetchHistory()
                if (hubTab === 'RANK') fetchLeaderboard()
                draw()
            }
        })
    })

    // Content
    const contentY = tabY + tabBarHeight
    const availableH = h - contentY
    
    context.save()
    context.beginPath()
    context.rect(0, contentY, w, availableH)
    context.clip()
    context.translate(0, contentY + scrollOffset)

    let drawnHeight = 0
    if (hubTab === 'SELECTION') drawnHeight = drawSelectionCard(w)
    else if (hubTab === 'HISTORY') drawnHeight = drawHistoryCard(w)
    else if (hubTab === 'RANK') drawnHeight = drawLeaderboardCard(w)
    
    context.restore()
    
    contentHeight = drawnHeight
    const minScroll = Math.min(0, availableH - contentHeight - 40)
    if (scrollOffset > 0) scrollOffset = 0
    if (scrollOffset < minScroll) scrollOffset = minScroll
}

function drawSelectionCard(w) {
    let y = 20
    const cardPadding = 20
    const cardW = w - 40
    
    // Level Selection Card
    context.fillStyle = Theme.textMain
    context.font = 'bold 18px sans-serif'
    context.textAlign = 'left'
    context.fillText('选择等级', 20, y)
    y += 30
    
    const gridCols = 2
    const cellW = (cardW - cardPadding * (gridCols + 1)) / gridCols
    const cellH = 50
    const levelRows = Math.ceil(LEVELS.length / gridCols)
    const levelCardH = 20 + levelRows * (cellH + 15) + 20 // Padding top/bottom
    
    // Draw Card Background
    drawCard(20, y, cardW, levelCardH)
    
    let innerY = y + 20
    LEVELS.forEach((level, i) => {
        const row = Math.floor(i / gridCols)
        const col = i % gridCols
        const lx = 20 + cardPadding + col * (cellW + cardPadding)
        const ly = innerY + row * (cellH + 15)
        
        const isSelected = selectedLevel === level
        // Selected: Primary Color, White Text. Not Selected: White (on White Card? No), Grey BG?
        // Prompt: "Secondary Button: Light Gray bg (#E4E7ED) + Dark Gray text"
        const btnBg = isSelected ? Theme.primary : Theme.secondary
        const btnTxt = isSelected ? Theme.primaryTxt : Theme.secondaryTxt
        
        drawButton(lx, ly, cellW, cellH, btnBg, level, '', true, () => {
            if (selectedLevel !== level) {
                selectedLevel = level
                // Reset buffer on level change
                storyBuffer = []
                isPrefetching = false
            }
            draw()
        }, btnTxt, 14, false, hubContentTop + scrollOffset + ly)
    })
    y += levelCardH + 30
    
    // Topic Selection Card
    context.fillStyle = Theme.textMain
    context.font = 'bold 18px sans-serif'
    context.textAlign = 'left'
    context.fillText('选择主题', 20, y)
    y += 30
    
    const topicRows = Math.ceil(TOPICS.length / gridCols)
    const topicCardH = 20 + topicRows * (cellH + 15) + 20
    
    drawCard(20, y, cardW, topicCardH)
    
    innerY = y + 20
    TOPICS.forEach((topic, i) => {
        const row = Math.floor(i / gridCols)
        const col = i % gridCols
        const tx = 20 + cardPadding + col * (cellW + cardPadding)
        const ty = innerY + row * (cellH + 15)
        
        const isSelected = selectedTopic === topic
        const btnBg = isSelected ? Theme.primary : Theme.secondary
        const btnTxt = isSelected ? Theme.primaryTxt : Theme.secondaryTxt
        
        drawButton(tx, ty, cellW, cellH, btnBg, topic, '', true, () => {
            if (selectedTopic !== topic) {
                selectedTopic = topic
                // Reset buffer on topic change
                storyBuffer = []
                isPrefetching = false
            }
            draw()
        }, btnTxt, 14, false, hubContentTop + scrollOffset + ty)
    })
    y += topicCardH + 40
    
    // Start Button
    drawButton(40, y, w - 80, 60, Theme.accent, '开始测试', '生成故事', true, () => {
        currentScene = 'game'
        startNewGame()
    }, '#FFFFFF', 20, false, hubContentTop + scrollOffset + y)
    
    return y + 100
}

function drawHistoryCard(w) {
    let y = 20
    
    if (isHubLoading) {
        context.fillStyle = Theme.textSub
        context.font = '16px sans-serif'
        context.textAlign = 'center'
        context.fillText('加载历史中...', w/2, y + 50)
        return y + 100
    }

    if (historyData.length === 0) {
        context.fillStyle = Theme.textSub
        context.textAlign = 'center'
        context.fillText('暂无历史记录', w/2, y + 50)
        return y + 100
    }
    
    historyData.forEach(item => {
        // Draw individual cards for history items
        drawCard(20, y, w - 40, 80)
        
        context.fillStyle = Theme.textMain
        context.font = 'bold 16px sans-serif'
        context.textAlign = 'left'
        context.fillText(item.topic, 40, y + 30) // Adjusted x for card padding
        
        context.fillStyle = Theme.textSub
        context.font = '14px sans-serif'
        context.fillText(item.level, 40, y + 55)
        
        context.fillStyle = Theme.accent
        context.font = 'bold 20px sans-serif'
        context.textAlign = 'right'
        context.fillText(`+${item.score}`, w - 40, y + 45)
        
        y += 95
    })
    return y + 20
}

function drawLeaderboardCard(w) {
    let y = 10
    
    // Sub-tabs
    const types = ['daily', 'weekly', 'total']
    const typeLabels = { 'daily': '日榜', 'weekly': '周榜', 'total': '总榜' }
    const subTabW = (w - 40) / 3
    
    types.forEach((t, i) => {
        const tx = 20 + i * subTabW
        const isSel = rankType === t
        const btnBg = isSel ? Theme.primary : Theme.secondary
        const btnTxt = isSel ? Theme.primaryTxt : Theme.secondaryTxt
        
        drawButton(tx, y, subTabW, 40, btnBg, typeLabels[t], '', true, () => {
            rankType = t
            fetchLeaderboard() 
        }, btnTxt, 14, false, hubContentTop + scrollOffset + y)
    })
    y += 60
    
    // Header
    // Let's put header inside the big card or above?
    // Let's draw a big card for the leaderboard list
    
    // Calculate height
    const rowH = 60
    const headerH = 40
    const listH = leaderboardData.length > 0 ? leaderboardData.length * rowH : 100
    const totalH = headerH + listH
    
    drawCard(20, y, w - 40, totalH)
    
    let innerY = y + 20
    
    context.fillStyle = Theme.textSub
    context.font = '12px sans-serif'
    context.textAlign = 'left'
    context.fillText('排名', 40, innerY)
    context.fillText('用户', 90, innerY)
    context.textAlign = 'right'
    context.fillText('得分', w - 40, innerY)
    
    context.fillStyle = Theme.border
    context.fillRect(40, innerY + 10, w - 80, 1) // Separator inside card
    
    innerY += 20
    
    if (isHubLoading) {
        context.fillStyle = Theme.textSub
        context.font = '16px sans-serif'
        context.textAlign = 'center'
        context.fillText('加载排名中...', w/2, innerY + 40)
        return y + totalH + 20
    }

    if (leaderboardData.length === 0) {
        context.fillStyle = Theme.textSub
        context.textAlign = 'center'
        context.fillText('暂无数据', w/2, innerY + 40)
        return y + totalH + 20
    }
    
    leaderboardData.forEach((item, index) => {
        const itemY = innerY + index * rowH
        
        // Rank
        context.fillStyle = item.rank <= 3 ? Theme.accent : Theme.textMain
        context.font = 'bold 16px sans-serif'
        context.textAlign = 'center'
        context.fillText(item.rank, 55, itemY + 35)
        
        // User
        context.fillStyle = Theme.textMain
        context.textAlign = 'left'
        context.font = '14px sans-serif'
        context.fillText(item.user || 'User', 90, itemY + 35)
        
        // Score
        context.fillStyle = Theme.primary
        context.textAlign = 'right'
        context.font = 'bold 16px sans-serif'
        context.fillText(item.score, w - 40, itemY + 35)
        
        // Separator line (except last)
        if (index < leaderboardData.length - 1) {
            context.fillStyle = Theme.border
            context.fillRect(40, itemY + 60, w - 80, 1)
        }
    })
    
    return y + totalH + 20
}



function drawGameScene(w, h) {
  const headerY = safeAreaTop
  
  // Header with shadow
  context.shadowBlur = 8
  context.shadowColor = Theme.shadow
  context.shadowOffsetY = 2
  context.fillStyle = Theme.surface
  context.fillRect(0, 0, w, safeAreaTop + headerHeight)
  context.shadowBlur = 0
  context.shadowOffsetY = 0
  
  // Back Button
  const backBtnH = 36
  drawButton(10, headerY + (headerHeight - backBtnH)/2, 80, backBtnH, 'transparent', '< 主页', '', true, () => {
    // Confirm exit?
    wx.showModal({
        title: '退出',
        content: '确定要退出当前游戏吗？进度将不会保存。',
        confirmText: '退出',
        cancelText: '取消',
        success: (res) => {
            if (res.confirm) {
                currentScene = 'wordweaver'
                draw()
            }
        }
    })
  }, Theme.primary, 16, true, null, Theme.primary)

  // Skip Button (Next to Hub/Back button)
  const skipBtnW = 70
  drawButton(100, headerY + (headerHeight - backBtnH)/2, skipBtnW, backBtnH, 'transparent', '>> 跳过', '', true, () => {
      wx.showModal({
          title: '跳过',
          content: '确定要跳过当前题目并进入下一组吗？',
          confirmText: '跳过',
          cancelText: '取消',
          success: (res) => {
              if (res.confirm) {
                  startNewGame()
              }
          }
      })
  }, Theme.primary, 16, true, null, Theme.primary)
  
  context.fillStyle = Theme.textMain
  context.font = 'bold 18px sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(selectedTopic, w / 2, headerY + headerHeight/2)
  
  // Removed border line in favor of shadow

  const tabY = safeAreaTop + headerHeight + 10
  drawTabBar(w, tabY)

  const contentY = tabY + tabBarHeight + 20
  let availableH = h - contentY
  if (currentTab === 'STORY') availableH -= audioPlayerHeight
  
  context.save()
  context.beginPath()
  context.rect(0, contentY, w, availableH)
  context.clip()
  context.translate(0, contentY + scrollOffset)
  
  let drawnHeight = 0
  if (gameState === 'GENERATING') {
    drawGenerating(w, availableH)
    drawnHeight = availableH
  } else if (gameState === 'ERROR') {
    drawError(w, availableH)
    drawnHeight = availableH
  } else if (gameState === 'READY') {
    if (currentTab === 'STORY') drawnHeight = drawStoryTab(w)
    else if (currentTab === 'WORDS') drawnHeight = drawWordsTab(w)
    else if (currentTab === 'TRANSLATION') drawnHeight = drawTranslationTab(w)
    else if (currentTab === 'QUIZ') drawnHeight = drawQuizTab(w)
  }
  
  context.restore()
  
  contentHeight = drawnHeight
  const minScroll = Math.min(0, availableH - contentHeight - 40)
  if (scrollOffset > 0) scrollOffset = 0
  if (scrollOffset < minScroll) scrollOffset = minScroll

  if (gameState === 'READY' && currentTab === 'STORY') {
    // Audio Player fixed at bottom
    drawAudioPlayer(w, h - audioPlayerHeight, audioPlayerHeight)
  }
}

function drawTabBar(w, startY) {
  const tabs = [
    { key: 'STORY', label: '故事' },
    { key: 'WORDS', label: '单词' },
    { key: 'TRANSLATION', label: '翻译' },
    { key: 'QUIZ', label: '测试' }
  ]
  const tabW = w / tabs.length
  
  context.shadowBlur = 8
  context.shadowColor = Theme.shadow
  context.shadowOffsetY = 2
  context.fillStyle = Theme.surface
  context.fillRect(0, startY, w, tabBarHeight)
  context.shadowBlur = 0
  context.shadowOffsetY = 0
  
  tabs.forEach((tab, index) => {
    const x = index * tabW
    const isActive = currentTab === tab.key
    
    context.fillStyle = isActive ? Theme.primary : Theme.textSub
    context.font = isActive ? 'bold 16px sans-serif' : '16px sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(tab.label, x + tabW / 2, startY + tabBarHeight / 2)
    
    if (isActive) {
      context.fillStyle = Theme.primary
      // Rounded indicator
      const indW = 20
      const indH = 3
      drawRoundedRect(context, x + tabW/2 - indW/2, startY + tabBarHeight - 4, indW, indH, 1.5, true, false)
    }
    
    activeButtons.push({
      x: x, y: startY, w: tabW, h: tabBarHeight,
      callback: () => {
        currentTab = tab.key
        scrollOffset = 0 
        draw()
      }
    })
  })
}

function drawLoading(w, h) {
  context.fillStyle = Theme.primary
  context.font = 'bold 20px sans-serif'
  context.textAlign = 'center'
  context.fillText('正在生成故事...', w / 2, h / 2 - 20)
  context.fillStyle = Theme.textSub
  context.font = '14px sans-serif'
  context.fillText('AI 魔法施展中...', w / 2, h / 2 + 10)
}



function drawError(w, h) {
  const msg = storyData ? storyData.error : 'Error'
  context.fillStyle = Theme.error
  context.font = 'bold 18px sans-serif'
  context.textAlign = 'center'
  context.fillText('生成失败', w / 2, h / 2 - 40)
  
  const lines = wrapText(context, msg, w - 60, 14)
  context.fillStyle = Theme.textSub
  lines.forEach((line, i) => {
    context.fillText(line, w / 2, h / 2 + i * 20)
  })
  
  const btnY = h / 2 + 60
  const screenY = contentTop + scrollOffset + btnY
  drawButton(w/2 - 60, btnY, 120, 44, Theme.primary, '重试', '', true, () => startNewGame(), Theme.textMain, 16, false, screenY)
}

function drawStoryTab(w) {
  let y = 20
  
  const text = storyData.content || ''
  // Card Width: w - 40
  // Text Width: w - 80 (20 padding each side inside card)
  const lines = wrapText(context, text, w - 80, 18)
  const lineHeight = 30
  
  const headerH = 40
  const textH = lines.length * lineHeight
  const totalH = headerH + textH + 40
  
  drawCard(20, y, w - 40, totalH)
  
  let innerY = y + 20
  
  context.fillStyle = Theme.primary
  context.font = 'bold 14px sans-serif'
  context.textAlign = 'left'
  context.fillText(`主题: ${selectedTopic} | 等级: ${selectedLevel}`, 40, innerY)
  innerY += 40
  
  context.textAlign = 'left'
  context.textBaseline = 'alphabetic'
  
  lines.forEach(line => {
    let currentX = 40 // Adjusted for card padding
    const parts = line.split(/(\*\*.*?\*\*)/g)
    parts.forEach(part => {
      if (part.startsWith('**') && part.endsWith('**')) {
        context.font = 'bold 18px sans-serif'
        context.fillStyle = Theme.primary
        const word = part.slice(2, -2)
        context.fillText(word, currentX, innerY)
        currentX += context.measureText(word).width
      } else {
        context.font = '18px sans-serif'
        context.fillStyle = Theme.textMain
        context.fillText(part, currentX, innerY)
        currentX += context.measureText(part).width
      }
    })
    innerY += lineHeight
  })
  return y + totalH + 40
}

function drawWordsTab(w) {
  let y = 20
  context.textAlign = 'left'
  context.fillStyle = Theme.textMain
  context.font = 'bold 20px sans-serif'
  context.fillText('关键词', 20, y)
  y += 40
  
  if (storyData.translation_map) {
    Object.keys(storyData.translation_map).forEach(word => {
      drawCard(20, y, w - 40, 90)
      
      context.fillStyle = Theme.primary
      context.font = 'bold 22px sans-serif'
      context.fillText(word, 40, y + 35)
      
      context.fillStyle = Theme.textSub
      context.font = '16px sans-serif'
      context.fillText(storyData.translation_map[word], 40, y + 65)
      y += 110
    })
  }
  return y + 20
}

function drawTranslationTab(w) {
  let y = 20
  const btnH = 44
  const screenY = contentTop + scrollOffset + y
  
  // Toggle Button
  const btnBg = showTranslation ? Theme.secondary : Theme.accent
  const btnTxt = showTranslation ? Theme.secondaryTxt : '#FFFFFF'
  
  drawButton(20, y, 160, btnH, btnBg, 
    showTranslation ? '隐藏翻译' : '显示翻译', '', true, 
    () => { showTranslation = !showTranslation; draw() }, btnTxt, 16, false, screenY)
    
  y += 60
  
  if (showTranslation && storyData.translation) {
    const lines = wrapText(context, storyData.translation, w - 80, 16)
    const textH = lines.length * 28 + 40
    
    drawCard(20, y, w - 40, textH)
    
    let innerY = y + 30
    
    context.fillStyle = Theme.textSub
    context.font = '16px sans-serif'
    context.textAlign = 'left'
    lines.forEach(line => {
      context.fillText(line, 40, innerY) // Adjusted for card padding
      innerY += 28
    })
    y += textH + 20
  } else if (!showTranslation) {
    context.fillStyle = Theme.textSub
    context.font = 'italic 16px sans-serif'
    context.textAlign = 'center'
    context.fillText('点击按钮查看翻译', w/2, y + 100)
    y += 200
  }
  return y + 20
}

function drawQuizTab(w) {
  let y = 30
  const q = storyData.quiz[quizIndex]
  if (!q) return y
  
  // Card Layout
  const cardW = w - 32 // 16px margin on each side
  const innerPadding = 24
  const textW = cardW - (innerPadding * 2)
  
  // Calculate Heights
  const qLines = wrapText(context, q.question, textW, 20) 
  const qTextHeight = qLines.length * 32 // 20px font, 32px line height
  
  const optionBtnH = 56
  const optionGap = 16
  const optionsHeight = q.options.length * (optionBtnH + optionGap)
  
  const actionBtnH = 50
  const actionSectionH = actionBtnH + 10 // +10 margin top
  
  // Total Card Height
  const totalH = 30 + qTextHeight + 30 + optionsHeight + 30 + actionSectionH + 30
  
  drawCard(16, y, cardW, totalH)
  
  let innerY = y + 30
  
  // Question Counter
  context.fillStyle = Theme.textSub
  context.font = 'bold 14px sans-serif'
  context.textAlign = 'center'
  context.fillText(`第 ${quizIndex + 1} / ${storyData.quiz.length} 题`, w/2, innerY)
  innerY += 30
  
  // Question Text
  context.fillStyle = Theme.textMain
  context.font = 'bold 20px sans-serif'
  context.textAlign = 'left'
  
  const startX = 16 + innerPadding
  
  qLines.forEach(line => {
    context.fillText(line, startX, innerY)
    innerY += 32
  })
  innerY += 30 // Gap before options
  
  // Options
  q.options.forEach(opt => {
    let bgColor = Theme.secondary 
    let txtColor = Theme.secondaryTxt
    let borderColor = null
    
    if (quizAnswered) {
      if (opt === q.answer) {
        bgColor = 'rgba(16, 185, 129, 0.15)' // Theme.accent low opacity
        borderColor = Theme.accent
        txtColor = Theme.accent
      } else if (opt === quizSelectedOption) {
        bgColor = 'rgba(239, 68, 68, 0.15)' // Theme.error low opacity
        borderColor = Theme.error
        txtColor = Theme.error
      }
    }
    
    drawButton(startX, innerY, textW, optionBtnH, bgColor, opt, '', true, () => handleAnswer(opt), txtColor, 16, false, contentTop + scrollOffset + innerY, borderColor)
    
    innerY += (optionBtnH + optionGap)
  })
  
  innerY += 14 // Extra gap before action buttons
  
  // Action Buttons (Skip & Next)
  const isLast = quizIndex === storyData.quiz.length - 1
  
  // Skip Button (Ghost Style)
  if (!isLast) {
      const skipW = 80
      drawButton(startX, innerY, skipW, actionBtnH, 'transparent', '跳过', '', true, () => {
          skipQuestion()
      }, Theme.textLight, 16, false, contentTop + scrollOffset + innerY)
  }
  
  const nextLabel = isLast ? '完成测试' : '下一题'
  const nextBtnW = isLast ? textW : (textW - 100) 
  
  const nextX = isLast ? startX : (startX + textW - nextBtnW)
  
  drawButton(nextX, innerY, nextBtnW, actionBtnH, Theme.primary, nextLabel, '', true, () => {
      if (quizAnswered) {
          if (isLast) finishQuiz()
          else nextQuestion()
      } else {
          wx.showToast({ title: '请选择一个答案', icon: 'none' })
      }
  }, Theme.primaryTxt, 18, false, contentTop + scrollOffset + innerY)
  
  return y + totalH + 40
}

function drawAudioPlayer(w, y, h) {
  // Shadow
  context.shadowBlur = 10
  context.shadowColor = Theme.shadow
  context.shadowOffsetY = -2
  
  context.fillStyle = Theme.surface
  context.fillRect(0, y, w, h)
  
  context.shadowBlur = 0
  context.shadowOffsetY = 0
  
  // Progress Bar
  context.fillStyle = Theme.secondary
  context.fillRect(0, y, w, 4)
  context.fillStyle = Theme.primary
  context.fillRect(0, y, w * audioProgress, 4)
  
  // Play/Pause Button
  const btnSize = 50
  const btnX = w / 2 - btnSize / 2
  const btnY = y + (h - btnSize) / 2 + 4
  
  drawButton(btnX, btnY, btnSize, btnSize, Theme.primary, isAudioPlaying ? '||' : '▶', '', true, () => toggleAudio(), Theme.primaryTxt, 24)
}

// --- Helper Functions ---

function drawCard(x, y, w, h) {
    context.fillStyle = Theme.surface
    context.shadowBlur = 16
    context.shadowColor = Theme.shadow
    context.shadowOffsetY = 4
    drawRoundedRect(context, x, y, w, h, 20, true, false)
    context.shadowBlur = 0
    context.shadowOffsetY = 0
}

function drawButton(x, y, w, h, bg, text, subtext, interactive, callback, textColor = '#fff', fontSize = 16, isFixed = false, screenY = null, borderColor = null) {
  context.fillStyle = bg
  
  if (borderColor) {
      context.strokeStyle = borderColor
      context.lineWidth = 1.5
  }
  
  drawRoundedRect(context, x, y, w, h, 14, true, !!borderColor)
  
  context.fillStyle = textColor
  context.font = `bold ${fontSize}px sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  
  if (subtext) {
    context.fillText(text, x + w / 2, y + h / 2 - 9)
    context.fillStyle = Theme.textSub
    context.font = '12px sans-serif'
    context.fillText(subtext, x + w / 2, y + h / 2 + 11)
  } else {
    context.fillText(text, x + w / 2, y + h / 2)
  }
  
  if (interactive) {
    activeButtons.push({
      x, y, w, h, callback, isFixed, screenY
    })
  }
}

function drawRoundedRect(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
  if (fill) ctx.fill()
  if (stroke) ctx.stroke()
}

function wrapText(context, text, maxWidth, fontSize) {
  context.font = `${fontSize}px sans-serif`
  const lines = []
  const paragraphs = text.split('\n')
  
  paragraphs.forEach(para => {
    let line = ''
    const words = para.split(' ')
    
    for (let n = 0; n < words.length; n++) {
      const word = words[n]
      const testLine = line + (line === '' ? '' : ' ') + word
      const metrics = context.measureText(testLine)
      const testWidth = metrics.width
      
      if (testWidth > maxWidth) {
        // Check if the word itself is longer than maxWidth (e.g. long Chinese string)
        if (context.measureText(word).width > maxWidth) {
            // If we have content in buffer, flush it
            if (line !== '') {
                lines.push(line)
                line = ''
            }
            
            // Break long word char by char
            let tempLine = ''
            for (let i = 0; i < word.length; i++) {
                const char = word[i]
                if (context.measureText(tempLine + char).width > maxWidth) {
                    lines.push(tempLine)
                    tempLine = char
                } else {
                    tempLine += char
                }
            }
            line = tempLine
        } else {
            // Normal word wrap
            lines.push(line)
            line = word
        }
      } else {
        line = testLine
      }
    }
    lines.push(line)
  })
  return lines
}

// --- Event Listeners ---

wx.onTouchStart((e) => {
  const touch = e.touches[0]
  touchStartY = touch.clientY
  isDragging = false
})

wx.onTouchMove((e) => {
  const touch = e.touches[0]
  const deltaY = touch.clientY - touchStartY
  
  // Only scroll if content is taller than available space
  if (Math.abs(deltaY) > 5) {
    isDragging = true
    scrollOffset += deltaY
    touchStartY = touch.clientY
    draw()
  }
})

wx.onTouchEnd((e) => {
  if (isDragging) return
  
  const touch = e.changedTouches[0]
  const x = touch.clientX
  const y = touch.clientY
  
  // Check buttons in reverse order (topmost first)
  for (let i = activeButtons.length - 1; i >= 0; i--) {
    const btn = activeButtons[i]
    
    let hit = false
    if (btn.isFixed) {
       // Fixed elements check against raw screen Y
       if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
         hit = true
       }
    } else if (btn.screenY !== null && btn.screenY !== undefined) {
       // Calculated screen coordinates
       if (x >= btn.x && x <= btn.x + btn.w && y >= btn.screenY && y <= btn.screenY + btn.h) {
         hit = true
       }
    } else {
       // Fallback for simple fixed elements (tab bar etc)
       if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
         hit = true
       }
    }
    
    if (hit) {
      if (btn.callback) btn.callback()
      break
    }
  }
})

// Initial Draw
draw()
