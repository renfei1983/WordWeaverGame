const { vocabularyDict } = require('./vocabulary.js')

// --- Plugins ---
// WechatSI has been removed as per user request (not supported in Mini Games).
// Using Cloud Hosting (Edge TTS) exclusively.

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
const CLOUD_ENV = 'cloudbase-1g6a925fc4f71607' // Cloud Base Environment ID (Function/DB)
const CLOUD_HOSTING_ENV = 'prod-5glh5gz97b0f6495' // Cloud Hosting Environment ID (TTS Service)
const USE_CLOUD = true
const USE_STREAM = true // Enable streaming
const USE_NATIVE_AI = true // Use WeChat Cloud Native AI (Hunyuan)
// Cloud Hosting URL (TTS Service) - Not used for callContainer, but good for reference
const CLOUD_API_URL = 'https://wordweaver-backend-prod-5glh5gz97b0f6495.cn-shanghai.run.tcloudbase.com' 
const BACKEND_VERSION = 'v1.11.4'

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
let userInfoBtn = null
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
      config: { env: CLOUD_HOSTING_ENV },
      path: finalPath,
      header: {
        'X-WX-SERVICE': 'flask-service', // Default service name
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
  
  // --- Enhanced 2026 Educational Prompt Engineering ---
  let system_persona = "You are an elite bilingual educator specializing in interdisciplinary teaching (CLIL)."
  let difficulty_context = ""
  
  // Level-specific adjustment
  if (level === "KET") {
      difficulty_context = "CEFR A2 (Elementary). STRICT CONSTRAINT: The story must be very short, UNDER 10 SENTENCES. Use simple Subject-Verb-Object structures. Vocabulary should be high-frequency daily words."
  } else if (level === "PET") {
      difficulty_context = "CEFR B1 (Intermediate). CONSTRAINT: The story must be concise, UNDER 15 SENTENCES. Introduce relative clauses and perfect tenses. Focus on clear narrative flow."
  } else if (level === "Junior High") {
      difficulty_context = "CEFR B1+. CONSTRAINT: The story must be concise, UNDER 15 SENTENCES. Mix formal and informal registers appropriate for school life. Use standard textbook grammar."
  } else if (level === "Senior High") {
      difficulty_context = "CEFR B2 (Upper Intermediate). CONSTRAINT: Use complex syntactic structures and longer sentences. Use sophisticated vocabulary, passive voice, and conditionals. Text should resemble a reputable news article or academic essay."
  } else if (level === "Postgraduate") {
      difficulty_context = "CEFR C1/C2 (Advanced). CONSTRAINT: Use highly complex syntactic structures, long sentences, and nuanced expression. Academic tone. Text should resemble The Economist or Nature."
  } else {
      difficulty_context = "CEFR B1. Standard difficulty."
  }

  // Topic-driven Scenario Injection (The "WordWeaver" Magic)
  // We explicitly guide the AI to weave words into specific, educational scenarios.
  let scenario_guidance = ""
  if (topic === "Daily Life") {
      scenario_guidance = "Scenario: A relatable day-to-day situation (e.g., shopping, travel, family dinner)."
  } else if (topic === "Science") {
      scenario_guidance = "Scenario: A popular science explanation or a lab experiment report."
  } else if (topic === "History") {
      scenario_guidance = "Scenario: A historical event narration or a biography of a famous figure."
  } else if (topic === "Technology") {
      scenario_guidance = "Scenario: A tech review or a futuristic sci-fi glimpse."
  } else {
      scenario_guidance = `Scenario: A creative context fitting the topic '${topic}'.`
  }

  return `
    ${system_persona}
    
    TASK: Compose a cohesive, engaging story that naturally integrates these target words: ${words_str}.
    
    CONTEXT & CONSTRAINTS:
    1. **Target Level**: ${difficulty_context}
    2. **Scenario**: ${scenario_guidance}
    3. **Word Integration**: Highlight target words in Markdown bold (**word**). They must fit grammatically and contextually.
    4. **Length**: 
       - KET: Strictly UNDER 10 sentences. Short and simple.
       - PET/Junior High: Strictly UNDER 15 sentences. Concise.
       - Senior High/Postgraduate: Longer, more complex text allowed (200+ words).
    
    OUTPUT REQUIREMENTS (JSON Format):
    1. **content**: The English story. Ensure proper paragraphing.
    2. **translation**: A high-quality Chinese translation that captures the tone and nuance, not just literal meaning.
    3. **translation_map**: Key-value pairs for the target words (English -> Chinese).
    4. **quiz**: Create 3 multiple-choice questions (A/B/C/D).
       - Question 1: **Vocabulary in Context** (Test the meaning of a target word in this specific story).
       - Question 2: **Reading Comprehension** (Test understanding of a plot point or detail).
       - Question 3: **Inference/Grammar** (Test implied meaning or grammatical usage of a target word).
       - **Crucial**: The 'answer' field must be the full string of the correct option (e.g., "Option A text").
    
    STRICT JSON OUTPUT STRUCTURE:
    {
        "content": "Story text...",
        "translation": "Chinese translation...",
        "translation_map": { "word": "translation" },
        "quiz": [
            {
                "question": "What does 'word' mean in the story?",
                "options": ["Meaning A", "Meaning B", "Meaning C", "Meaning D"],
                "answer": "Meaning A"
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

        // --- Step 1: Call AI Model (DeepSeek Provider / Qwen Model) ---
        ;(async () => {
            try {
                // User requested specific configuration for DeepSeek provider but using Qwen model
                // Provider: deepseek
                // Model: Qwen/Qwen3-32B
                const modelId = "Qwen/Qwen3-32B"
                console.log('Using Model ID:', modelId)

                // Create Model Instance with "deepseek" as requested
                const ai = await wx.cloud.extend.AI.createModel("deepseek")

                // Call streamText
                const res = await ai.streamText({
                    data: {
                        model: modelId, 
                        messages: [
                            { role: "system", content: "You are a helpful assistant that outputs raw JSON without markdown formatting." },
                            { role: "user", content: prompt }
                        ]
                    }
                })

                // Handle Stream
                if (res.eventStream) {
                    for await (const event of res.eventStream) {
                        if (event.data === "[DONE]") {
                            break
                        }
                        try {
                            const data = JSON.parse(event.data)
                            
                            // Handle reasoning_content (DeepSeek style thinking)
                            const think = data?.choices?.[0]?.delta?.reasoning_content
                            if (think) {
                                console.log('[AI Think]', think)
                            }

                            // Handle content
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
                console.error('DeepSeek AI Exception:', err)
                if (onFail) onFail(err)
            }
        })()
        
        return
    }

    // --- Option 2/Fallback: Cloud Container / Local ---
    // Note: Backend is now TTS-only. Block generate_story fallback.
    if (path === '/generate_story') {
        console.warn('generate_story fallback blocked (Backend is TTS only)')
        if (onFail) onFail(new Error('Backend does not support generate_story. Check Native AI config.'))
        return
    }

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
            
            // Check for 429 Too Many Requests
            if (err && (err.statusCode === 429 || (err.errMsg && err.errMsg.includes('429')))) {
                console.warn('429 Too Many Requests detected. Skipping fallback to prevent double-load.')
                if (onFail) onFail(err)
                return
            }

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
      const guestId = 'guest_' + Math.random().toString(36).substr(2, 9)
      if (user) {
          user.openid = guestId
      } else {
          user = { openid: guestId }
      }
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
              if (user) {
                  user.openid = openid
              } else {
                  user = { openid }
              }
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
          config: { env: CLOUD_ENV }, // Explicitly set env
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
          data: { 
              action: 'get_leaderboard',
              data: { type: rankType } 
          }
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
  // Fisher-Yates Shuffle
  const shuffled = [...list]
  for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count)
}

let prefetchRetryCount = 0;
const MAX_PREFETCH_RETRIES = 5;
const PREFETCH_DELAY_MS = 5000; // 5 seconds delay between serial calls
let totalPrefetchedCount = 0; // Total successful prefetches in current session
const MAX_TOTAL_PREFETCH = 5; // Hard limit for session
let globalAiErrorCount = 0; // Global counter for ALL AI failures
const MAX_GLOBAL_AI_ERRORS = 5; // Max allowed failures before circuit breaking

function prefetchStory(onProgress) {
    // Check circuit breaker first
    if (globalAiErrorCount >= MAX_GLOBAL_AI_ERRORS) {
        console.error('Global AI Error Limit Reached. Aborting request.')
        // DO NOT SHOW MODAL if not generating.
        if (gameState === 'GENERATING') {
            wx.showModal({
                title: '服务暂时不可用',
                content: 'AI 服务连接失败次数过多，请稍后重试。',
                showCancel: false,
                success: () => {
                    currentScene = 'wordweaver' 
                    draw()
                }
            })
        }
        return
    }

    // Check buffer size, lock, AND total session limit
    // Also, enforce a minimum timestamp gap if needed? 
    // Let's rely on isPrefetching for now.
    
    if (storyBuffer.length >= 3 || isPrefetching || totalPrefetchedCount >= MAX_TOTAL_PREFETCH) {
        if (totalPrefetchedCount >= MAX_TOTAL_PREFETCH) {
            console.log('Max session prefetch limit reached (5). Stopping background loading.')
        } else if (isPrefetching) {
            console.log('Already prefetching (locked). Skipping duplicate call.')
        }
        return
    }

    isPrefetching = true
    const words = pickRandomWords(5)
    
    // Capture current settings to verify consistency later
    const requestedTopic = selectedTopic
    const requestedLevel = selectedLevel
    
    // Add unique request ID for tracking
    const requestId = Date.now().toString().slice(-6);
    console.log(`[${requestId}] Prefetching story (Stream)...`, requestedTopic, requestedLevel)
    
    let accumulatedJSON = ""
    
    callApiStream('/generate_story', 'GET', {
        words: words,
        topic: requestedTopic,
        level: requestedLevel
    }, (chunk) => {
        // onChunk
        accumulatedJSON += chunk
        if (onProgress) onProgress() 
        // Reset retry count on successful data receipt
        prefetchRetryCount = 0;
        // globalAiErrorCount = 0; // Don't reset global error count on just ONE chunk. Only on full success.
    }, () => {
        // onSuccess
        isPrefetching = false; // Release lock immediately
        globalAiErrorCount = 0; // Reset global error count on FULL success

        // Consistency check: discard if settings changed during fetch
        if (selectedTopic !== requestedTopic || selectedLevel !== requestedLevel) {
            console.log('Discarding prefetched story due to settings change')
            // Retry with new settings if buffer low, with delay
            if (storyBuffer.length < 3) {
                 setTimeout(() => prefetchStory(onProgress), PREFETCH_DELAY_MS);
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
                totalPrefetchedCount++; // Increment session count
                console.log('Story buffered. Current buffer size:', storyBuffer.length, 'Total:', totalPrefetchedCount)
                
                // If waiting for this story, start game immediately (no delay for user waiting)
                if (gameState === 'GENERATING' && storyBuffer.length > 0) {
                     startNewGame()
                     // Don't trigger recursive fill here; startNewGame handles it if needed
                     // But we want to fill buffer in background, so...
                }
            }
        } catch (e) {
            console.error('JSON Parse Error', e)
        }

        // Serial Execution with Delay:
        // Only if we need more stories and not already prefetching (lock released above)
        // User request: Change prefetch limit to 2 (current + 1 buffered)
        // So buffer length should be checked against 1 (since current is playing, buffer stores next ones)
        // Actually, if we want "current + 1", buffer should have 1 item ready.
        // If we want "total 2 generated", it means 1 active + 1 waiting.
        if (storyBuffer.length < 1) { // Changed from < 3 to < 1
            console.log(`Scheduling next prefetch in ${PREFETCH_DELAY_MS}ms...`);
            setTimeout(() => {
                prefetchStory(); // No callback for background fill
            }, PREFETCH_DELAY_MS);
        }

    }, (err) => {
        console.error('Prefetch Error', err)
        isPrefetching = false
        globalAiErrorCount++; // Increment global error counter
        console.error('Prefetch Error. Global Error Count:', globalAiErrorCount)

        // Check if we hit the global limit immediately
        if (globalAiErrorCount >= MAX_GLOBAL_AI_ERRORS) {
            console.error('Global AI Error Limit Reached (in callback). Stopping all retries.')
            if (gameState === 'GENERATING') {
                wx.showModal({
                    title: '服务暂时不可用',
                    content: 'AI 服务连接失败次数过多，请稍后重试。',
                    showCancel: false,
                    success: () => {
                        currentScene = 'wordweaver' 
                        draw()
                    }
                })
            }
            return // STOP EVERYTHING
        }
        
        // Handle 429 Too Many Requests with Exponential Backoff
        if (err && (err.statusCode === 429 || (err.message && err.message.includes('429')))) {
            prefetchRetryCount++;
            if (prefetchRetryCount <= MAX_PREFETCH_RETRIES) {
                // Ensure retry delay is AT LEAST 5 seconds (5000ms)
                // Original: 2, 4, 8, 16, 32 -> New: 5, 5, 8, 16, 32
                let delay = Math.pow(2, prefetchRetryCount) * 1000; 
                if (delay < 5000) delay = 5000;
                
                console.log(`Rate limited (429). Retrying in ${delay}ms... (Attempt ${prefetchRetryCount}/${MAX_PREFETCH_RETRIES})`);
                setTimeout(() => {
                    prefetchStory(onProgress);
                }, delay);
                return; // Exit and wait for timeout
            } else {
                console.error('Max prefetch retries reached for 429. Stopping prefetch.');
                if (gameState === 'GENERATING') {
                    wx.showModal({
                        title: '请求过于频繁',
                        content: 'AI 服务繁忙，请稍后再试。',
                        showCancel: false,
                        success: () => {
                            currentScene = 'wordweaver' // Go back to hub
                            draw()
                        }
                    })
                }
                return;
            }
        }
        
        // For other errors, force stop recursion to prevent infinite loops
        console.error('Non-429 Prefetch Error. Stopping recursion to prevent loops.', err)
        if (gameState === 'GENERATING') {
            wx.showModal({
                title: '生成失败',
                content: '网络或服务异常，请稍后重试。',
                showCancel: false,
                success: () => {
                    currentScene = 'wordweaver' // Go back to hub
                    draw()
                }
            })
        }
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
        // Trigger background prefetch to refill - DISABLED to prevent runaway requests
        // prefetchStory()
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
  // Only save record if user answered at least 1 question correctly
  // Relaxed from 3 to 1 to allow partial success to be recorded
  if (correctCount < 1) {
      console.log('Skipping record save: No correct answers')
      return
  }

  if (!user || !user.openid || !storyData) {
      console.error('Save failed: Missing user or storyData', { user, hasStoryData: !!storyData })
      return
  }
  
  const wordsList = []
  if (storyData.translation_map) {
    Object.keys(storyData.translation_map).forEach(key => {
      wordsList.push({ word: key, meaning: storyData.translation_map[key] })
    })
  } else {
    console.warn('Save warning: No translation_map in storyData', storyData)
  }

  console.log('Attempting to save record...', { 
      count: wordsList.length, 
      level: selectedLevel, 
      topic: selectedTopic 
  })

  // Use Cloud Function
  if (USE_CLOUD && wx.cloud) {
      wx.cloud.callFunction({
          name: 'wordweaver',
          config: { env: CLOUD_ENV }, // Explicitly set env
          data: { 
              action: 'record_learning',
              data: {
                  words: wordsList,
                  source_level: selectedLevel,
                  topic: selectedTopic
              }
          }
      }).then(res => {
          console.log('Record saved via Cloud Function')
          wx.showToast({ title: '记录已保存', icon: 'success' })
      }).catch(err => {
          console.error('Record save failed', err)
      })
  } else {
      console.log('Cloud not enabled, skipping record save')
  }
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
  
  const text = storyData.content.replace(/\*\*/g, '')

  console.log("Requesting TTS from Cloud Container (Edge TTS)...")
  wx.showLoading({ title: '加载音频...' })
  
  wx.cloud.callContainer({
    config: { env: CLOUD_HOSTING_ENV },
    path: `/audio?text=${encodeURIComponent(text.slice(0, 5000))}`,
    method: 'GET',
    header: { 'X-WX-SERVICE': 'wordweaver-backend' }, // Explicit service name matching URL
    timeout: 60000, // 60s timeout for cold starts
    responseType: 'arraybuffer',
    success: (res) => {
        wx.hideLoading()
        if (res.statusCode === 200 && res.data.byteLength > 0) {
            const fs = wx.getFileSystemManager()
            const filePath = `${wx.env.USER_DATA_PATH}/tts_backend_${Date.now()}.mp3`
            try {
                fs.writeFileSync(filePath, res.data, 'binary')
                currentAudioSrc = filePath
                if (!audioCtx) initAudio()
                audioCtx.stop()
                audioCtx.src = currentAudioSrc
                audioCtx.play()
            } catch (e) {
                console.error('File Write Error', e)
                wx.showToast({ title: '写入失败', icon: 'none' })
            }
        } else {
            console.error('Backend TTS Failed', res)
            wx.showToast({ title: '音频生成失败', icon: 'none' })
        }
    },
    fail: (err) => {
        wx.hideLoading()
        console.error('Backend Request Error', err)
        wx.showToast({ title: '连接后端失败', icon: 'none' })
    }
  })
}

// --- Drawing Functions ---

function draw() {
  activeButtons = []
  const { windowWidth, windowHeight } = wx.getSystemInfoSync()
  
  // Cleanup UserInfoButton if not in Hub
  if (currentScene !== 'hub' && userInfoBtn) {
    userInfoBtn.destroy()
    userInfoBtn = null
  }

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

  // UserInfoButton for getting nickname/avatar
  if (!user || !user.userInfo) {
      if (!userInfoBtn) {
          userInfoBtn = wx.createUserInfoButton({
            type: 'text',
            text: '',
            style: {
              left: 30,
              top: startY,
              width: btnW,
              height: btnH,
              lineHeight: 40,
              backgroundColor: '#00000000',
              color: '#ffffff',
              textAlign: 'center',
              fontSize: 16,
              borderRadius: 4
            }
          })
          
          userInfoBtn.onTap((res) => {
              if (res.userInfo) {
                  // User authorized
                  if (user) {
                      user.userInfo = res.userInfo
                  } else {
                      user = { userInfo: res.userInfo }
                  }
                  wx.setStorageSync('user', user)
              }
              
              // Proceed regardless of auth result
              if (!isLogin) {
                  login()
              }
              currentScene = 'wordweaver'
              hubTab = 'SELECTION'
              draw()
          })
      } else {
          // Update position in case of resize (though usually fixed)
          userInfoBtn.style.left = 30
          userInfoBtn.style.top = startY
          userInfoBtn.style.width = btnW
          userInfoBtn.style.height = btnH
      }
  } else {
      if (userInfoBtn) {
          userInfoBtn.destroy()
          userInfoBtn = null
      }
  }

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
    drawButton(10, headerY + (headerHeight - backBtnH)/2, 60, backBtnH, 'transparent', '<', '', true, () => {
        currentScene = 'hub'
        draw()
    }, Theme.primary, 24, true, null, Theme.primary) // Ghost button style

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
        context.fillText('暂无学习记录', w/2, y + 50)
        return y + 100
    }
    
    // Draw list of learned words
    historyData.forEach((item, index) => {
        // item: { word: 'apple', meaning: '苹果', date: '...' }
        drawCard(20, y, w - 40, 70)
        
        context.fillStyle = Theme.textMain
        context.font = 'bold 18px sans-serif'
        context.textAlign = 'left'
        context.fillText(item.word, 40, y + 30) 
        
        context.fillStyle = Theme.textSub
        context.font = '16px sans-serif'
        context.textAlign = 'right'
        context.fillText(item.meaning, w - 40, y + 30)

        // Date (optional)
        if (item.date) {
            context.fillStyle = Theme.textLight
            context.font = '12px sans-serif'
            context.textAlign = 'left'
            const dateStr = new Date(item.date).toLocaleDateString()
            context.fillText(dateStr, 40, y + 55)
        }
        
        y += 85
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
            if (rankType !== t) {
                rankType = t
                fetchLeaderboard()
            }
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
  const backBtnH = 30
  const backBtnW = 40
  drawButton(10, headerY + (headerHeight - backBtnH)/2, backBtnW, backBtnH, 'transparent', '<', '', true, () => {
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
  const skipBtnW = 40
  drawButton(10 + backBtnW + 10, headerY + (headerHeight - backBtnH)/2, skipBtnW, backBtnH, 'transparent', '>', '', true, () => {
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
  const qLines = wrapText(context, q.question, textW, 20, 'bold') 
  const qTextHeight = qLines.length * 32 // 20px font, 32px line height
  
  const optionGap = 16
  const optionHeights = q.options.map(opt => {
      // Estimate height: bold 16px
      const lines = wrapText(context, opt, textW - 20, 16, 'bold') // -20 padding in drawButton
      const lineHeight = 16 * 1.3
      const neededH = lines.length * lineHeight + 24 // +24 vertical padding
      return Math.max(56, neededH)
  })
  
  const optionsHeight = optionHeights.reduce((a, b) => a + b, 0) + (Math.max(0, q.options.length - 1)) * optionGap
  
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
  q.options.forEach((opt, index) => {
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
    
    const h = optionHeights[index]
    drawButton(startX, innerY, textW, h, bgColor, opt, '', true, () => handleAnswer(opt), txtColor, 16, false, contentTop + scrollOffset + innerY, borderColor)
    
    innerY += (h + optionGap)
  })
  
  innerY += 14 // Extra gap before action buttons
  
  // Action Buttons (Skip & Next)
  const isLast = quizIndex === storyData.quiz.length - 1
  
  // Skip Button (Ghost Style)
  if (!isLast) {
      const skipW = 60
      drawButton(startX, innerY, skipW, actionBtnH, 'transparent', '>', '', true, () => {
          skipQuestion()
      }, Theme.textLight, 24, false, contentTop + scrollOffset + innerY)
  }
  
  const nextLabel = isLast ? '完成测试' : '下一题'
  const nextBtnW = isLast ? textW : (textW - 80) 
  
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
    // Check for multiline
    const maxW = w - 20
    const lines = wrapText(context, text, maxW, fontSize, 'bold')
    
    if (lines.length > 1) {
        const lineHeight = fontSize * 1.3
        const totalH = lines.length * lineHeight
        // Start Y is top of text block. 
        // fillText draws at baseline (middle). 
        // Let's calculate center of block.
        // First line center Y = (y + h/2) - (totalH/2) + (lineHeight/2)
        let lineY = y + (h - totalH) / 2 + lineHeight / 2
        
        lines.forEach(line => {
            context.fillText(line, x + w / 2, lineY)
            lineY += lineHeight
        })
    } else {
        context.fillText(text, x + w / 2, y + h / 2)
    }
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

function wrapText(context, text, maxWidth, fontSize, fontWeight = '') {
  context.font = `${fontWeight} ${fontSize}px sans-serif`.trim()
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
