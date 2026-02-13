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
    fail: (e) => console.error('Global Audio Option Failed', e)
  })
}

const canvas = wx.createCanvas()
const context = canvas.getContext('2d')

// --- Configuration ---
const CLOUD_ENV = 'prod-9g8femu80d9d37f3'
const USE_CLOUD = true
const BACKEND_VERSION = 'v1.4.0'

// --- Constants ---
const LEVELS = ['Primary School', 'KET', 'PET', 'Junior High', 'Senior High', 'Postgraduate']
const TOPICS = ['Daily Life', 'Science', 'Art', 'Harry Potter', 'Avengers', 'Minecraft']

// --- Theme Configuration (Modern Minimalism) ---
const Theme = {
  bg: '#F5F7FA',       // Light Grey Background (Global)
  surface: '#FFFFFF',  // Pure White (Cards/Surface)
  primary: '#409EFF',  // Soft Blue (Primary Action)
  primaryTxt: '#FFFFFF', // Text on Primary
  secondary: '#E4E7ED', // Light Gray (Secondary Action)
  secondaryTxt: '#606266', // Text on Secondary
  textMain: '#303133', // Dark Gray (Headings)
  textSub: '#606266',  // Medium Gray (Subtext)
  textLight: '#909399', // Lighter Gray (Auxiliary)
  accent: '#67C23A',   // Green (Success/Start)
  error: '#F56C6C',    // Soft Red
  border: '#DCDFE6',   // Light Border
  shadow: 'rgba(0, 0, 0, 0.05)' // Very subtle shadow
}

// --- System Info & Layout ---
const sysInfo = wx.getSystemInfoSync()
const safeAreaTop = sysInfo.statusBarHeight || 20
const headerHeight = 54 // Increased for better touch target and spacing
const tabBarHeight = 60 // Increased for easier clicking
const audioPlayerHeight = 90
const contentTop = safeAreaTop + headerHeight + tabBarHeight

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
  callApi('/', 'GET', null, () => {}, () => {})
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

function login() {
  wx.showLoading({ title: '登录中...' })
  wx.login({
    success: async (res) => {
      const payload = { code: res.code || "cloud_mode", userInfo: null }
      callApi('/login', 'POST', payload, (resp) => {
        wx.hideLoading()
        if (resp.statusCode === 200) {
          const { openid } = resp.data
          user = { openid }
          isLogin = true
          wx.setStorageSync('user', user)
          draw()
          wx.showToast({ title: '登录成功' })
        } else {
          wx.showToast({ title: '登录失败', icon: 'none' })
        }
      }, () => {
        wx.hideLoading()
        wx.showToast({ title: '网络错误', icon: 'none' })
      })
    },
    fail: () => {
      wx.hideLoading()
      wx.showToast({ title: '微信登录失败', icon: 'none' })
    }
  })
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
  callApi(`/quiz_history?openid=${user.openid}`, 'GET', null, (res) => {
    historyData = res.data || []
    isHubLoading = false
    draw()
  }, (err) => {
    console.error(err)
    isHubLoading = false
    draw()
  })
}

function fetchLeaderboard() {
  isHubLoading = true
  draw()
  callApi(`/leaderboard?type=${rankType}`, 'GET', null, (res) => {
    leaderboardData = res.data || []
    isHubLoading = false
    draw()
  }, (err) => {
    console.error(err)
    isHubLoading = false
    draw()
  })
}

// --- Game Logic ---

function pickRandomWords(count = 5) {
  const list = vocabularyDict[selectedLevel] || vocabularyDict['Junior High'] || []
  const shuffled = [...list].sort(() => 0.5 - Math.random())
  return shuffled.slice(0, count)
}

function startNewGame() {
  gameState = 'LOADING'
  currentWords = pickRandomWords(5)
  storyData = null
  quizIndex = 0
  score = 0
  quizSelectedOption = null
  quizAnswered = false
  isSubmitting = false
  currentTab = 'STORY'
  scrollOffset = 0
  isAudioPlaying = false
  audioProgress = 0
  currentAudioSrc = ''
  audioCtx.stop()
  
  draw()

  callApi('/generate_story', 'GET', {
    words: currentWords,
    topic: selectedTopic,
    level: selectedLevel
  }, (res) => {
    storyData = res.data
    gameState = 'READY'
    draw()
  }, (err) => {
    console.error('Story Gen Error', err)
    gameState = 'ERROR'
    let msg = '未知错误'
    if (err.data && err.data.detail) msg = err.data.detail
    else if (err.errMsg) msg = err.errMsg
    storyData = { error: msg }
    draw()
  })
}

function handleAnswer(option) {
  if (quizAnswered) return
  quizSelectedOption = option
  quizAnswered = true
  
  const currentQ = storyData.quiz[quizIndex]
  if (option === currentQ.answer) {
    score += 10
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
    
    wx.showToast({ title: '完成! +5积分', icon: 'success' })
    saveRecord()
    submitScore(5) // Award 5 points for completing the set
    
    // Return to hub after delay
    setTimeout(() => {
        currentScene = 'wordweaver'
        hubTab = 'HISTORY' // Show history
        fetchHistory()
        draw()
        isSubmitting = false
    }, 2000)
}

function submitScore(points) {
    if (!user || !user.openid) return
    callApi('/submit_quiz', 'POST', {
        openid: user.openid,
        topic: selectedTopic,
        level: selectedLevel,
        score: points
    }, () => {
        console.log('Score submitted')
    }, (err) => console.error('Score submit failed', err))
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
  
  drawButton(30, startY, btnW, btnH, Theme.primary, 'WordWeaver', 'Interactive Story & Quiz', true, () => {
    if (!isLogin) { login(); return }
    currentScene = 'wordweaver'
    hubTab = 'SELECTION'
    draw()
  }, Theme.primaryTxt, 22)

  drawButton(30, startY + 110, btnW, btnH, Theme.secondary, 'MathMind', 'Coming Soon', false, null, Theme.secondaryTxt, 22)
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
    drawButton(10, headerY + (headerHeight - backBtnH)/2, 80, backBtnH, 'transparent', '< Hub', '', true, () => {
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
        { key: 'SELECTION', label: 'Start' },
        { key: 'HISTORY', label: 'History' },
        { key: 'RANK', label: 'Rank' }
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
    context.fillText('Select Level', 20, y)
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
            selectedLevel = level
            draw()
        }, btnTxt, 14, false, contentTop + scrollOffset + ly)
    })
    y += levelCardH + 30
    
    // Topic Selection Card
    context.fillStyle = Theme.textMain
    context.font = 'bold 18px sans-serif'
    context.textAlign = 'left'
    context.fillText('Select Topic', 20, y)
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
            selectedTopic = topic
            draw()
        }, btnTxt, 14, false, contentTop + scrollOffset + ty)
    })
    y += topicCardH + 40
    
    // Start Button
    drawButton(40, y, w - 80, 60, Theme.accent, 'Start Quiz', 'Create Story', true, () => {
        currentScene = 'game'
        startNewGame()
    }, '#FFFFFF', 20, false, contentTop + scrollOffset + y)
    
    return y + 100
}

function drawHistoryCard(w) {
    let y = 20
    
    if (isHubLoading) {
        context.fillStyle = Theme.textSub
        context.font = '16px sans-serif'
        context.textAlign = 'center'
        context.fillText('Loading history...', w/2, y + 50)
        return y + 100
    }

    if (historyData.length === 0) {
        context.fillStyle = Theme.textSub
        context.textAlign = 'center'
        context.fillText('No history yet', w/2, y + 50)
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
    const subTabW = (w - 40) / 3
    
    types.forEach((t, i) => {
        const tx = 20 + i * subTabW
        const isSel = rankType === t
        const btnBg = isSel ? Theme.primary : Theme.secondary
        const btnTxt = isSel ? Theme.primaryTxt : Theme.secondaryTxt
        
        drawButton(tx, y, subTabW, 40, btnBg, t.toUpperCase(), '', true, () => {
            rankType = t
            // fetchLeaderboard() // Already fetched? Or trigger fetch
            // Ideally we should fetch if not cached or always fetch on switch
            // But let's keep existing logic, just update UI
            // Assuming logic handles fetch elsewhere or this is just UI
        }, btnTxt, 12, false, contentTop + scrollOffset + y)
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
    context.fillText('RANK', 40, innerY)
    context.fillText('USER', 90, innerY)
    context.textAlign = 'right'
    context.fillText('SCORE', w - 40, innerY)
    
    context.fillStyle = Theme.border
    context.fillRect(40, innerY + 10, w - 80, 1) // Separator inside card
    
    innerY += 20
    
    if (isHubLoading) {
        context.fillStyle = Theme.textSub
        context.font = '16px sans-serif'
        context.textAlign = 'center'
        context.fillText('Loading rankings...', w/2, innerY + 40)
        return y + totalH + 20
    }

    if (leaderboardData.length === 0) {
        context.fillStyle = Theme.textSub
        context.textAlign = 'center'
        context.fillText('No data available', w/2, innerY + 40)
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
  drawButton(10, headerY + (headerHeight - backBtnH)/2, 80, backBtnH, 'transparent', '< Hub', '', true, () => {
    currentScene = 'wordweaver'
    hubTab = 'SELECTION'
    audioCtx.stop()
    draw()
  }, Theme.primary, 16, true, null, Theme.primary)
  
  context.fillStyle = Theme.textMain
  context.font = 'bold 18px sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText('WordWeaver', w / 2, headerY + headerHeight/2)
  
  // Removed border line in favor of shadow

  const tabY = safeAreaTop + headerHeight
  drawTabBar(w, tabY)

  const contentY = tabY + tabBarHeight
  let availableH = h - contentY
  if (currentTab === 'STORY') availableH -= audioPlayerHeight
  
  context.save()
  context.beginPath()
  context.rect(0, contentY, w, availableH)
  context.clip()
  context.translate(0, contentY + scrollOffset)
  
  let drawnHeight = 0
  if (gameState === 'LOADING') {
    drawLoading(w, availableH)
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
    { key: 'STORY', label: 'Story' },
    { key: 'WORDS', label: 'Words' },
    { key: 'TRANSLATION', label: 'CN' },
    { key: 'QUIZ', label: 'Quiz' }
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
  context.fillText('Generating Story...', w / 2, h / 2 - 20)
  context.fillStyle = Theme.textSub
  context.font = '14px sans-serif'
  context.fillText('AI Magic in progress...', w / 2, h / 2 + 10)
}

function drawError(w, h) {
  const msg = storyData ? storyData.error : 'Error'
  context.fillStyle = Theme.error
  context.font = 'bold 18px sans-serif'
  context.textAlign = 'center'
  context.fillText('Failed to Generate', w / 2, h / 2 - 40)
  
  const lines = wrapText(context, msg, w - 60, 14)
  context.fillStyle = Theme.textSub
  lines.forEach((line, i) => {
    context.fillText(line, w / 2, h / 2 + i * 20)
  })
  
  const btnY = h / 2 + 60
  const screenY = contentTop + scrollOffset + btnY
  drawButton(w/2 - 60, btnY, 120, 44, Theme.primary, 'Retry', '', true, () => startNewGame(), Theme.textMain, 16, false, screenY)
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
  context.fillText(`Topic: ${selectedTopic} | Level: ${selectedLevel}`, 40, innerY)
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
  context.fillText('Keywords', 20, y)
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
    showTranslation ? 'Hide' : 'Show Translation', '', true, 
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
    context.fillText('Tap button to see translation', w/2, y + 100)
    y += 200
  }
  return y + 20
}

function drawQuizTab(w) {
  let y = 20
  const q = storyData.quiz[quizIndex]
  if (!q) return y
  
  // Calculate Card Height
  const qLines = wrapText(context, q.question, w - 80, 18) // Adjusted for card padding
  const qTextHeight = qLines.length * 28
  
  const optionsHeight = q.options.length * 65
  const buttonsHeight = 44 + 20
  
  const totalH = 30 + qTextHeight + 20 + optionsHeight + buttonsHeight + 40
  
  drawCard(20, y, w - 40, totalH)
  
  let innerY = y + 20
  
  context.fillStyle = Theme.textSub
  context.font = '14px sans-serif'
  context.textAlign = 'center'
  context.fillText(`Question ${quizIndex + 1} of ${storyData.quiz.length}`, w/2, innerY)
  innerY += 40
  
  context.fillStyle = Theme.textMain
  context.font = 'bold 18px sans-serif'
  context.textAlign = 'left'
  
  qLines.forEach(line => {
    context.fillText(line, 40, innerY)
    innerY += 28
  })
  innerY += 20
  
  q.options.forEach(opt => {
    let bgColor = Theme.secondary // Default option bg (Ghost/Light Grey)
    let txtColor = Theme.textMain
    let borderColor = null
    
    if (quizAnswered) {
      if (opt === q.answer) {
        bgColor = 'rgba(103, 194, 58, 0.2)' // Theme.accent with opacity
        borderColor = Theme.accent
        txtColor = Theme.accent
      } else if (opt === quizSelectedOption) {
        bgColor = 'rgba(245, 108, 108, 0.2)' // Theme.error with opacity
        borderColor = Theme.error
        txtColor = Theme.error
      }
    }
    
    // Use Ghost Button style for options? Or Light Grey?
    // Prompt: "Secondary Button: Light Gray background (#E4E7ED) + Dark Gray text"
    // So Theme.secondary is fine.
    
    drawButton(40, innerY, w - 80, 50, bgColor, opt, '', true, () => handleAnswer(opt), txtColor, 16, false, contentTop + scrollOffset + innerY, borderColor)
    
    innerY += 65
  })
  
  innerY += 10
  
  // Next / Skip Button
  const btnW = (w - 100) / 2 // Adjusted width for card padding (40 left + 40 right + 20 gap)
  const isLast = quizIndex === storyData.quiz.length - 1
  
  // Skip Button (Left)
  if (!isLast) {
      drawButton(40, innerY, btnW, 44, 'transparent', 'Skip', '', true, () => {
          skipQuestion()
      }, Theme.textSub, 16, false, contentTop + scrollOffset + innerY, Theme.border) // Ghost button with border
  }
  
  const nextLabel = isLast ? 'Finish' : 'Next'
  
  const rightBtnX = isLast ? (w - 140)/2 + 20 : (40 + btnW + 20)
  const rightBtnW = isLast ? 100 : btnW
  
  drawButton(rightBtnX, innerY, rightBtnW, 44, Theme.primary, nextLabel, '', true, () => {
      if (quizAnswered) {
          if (isLast) finishQuiz()
          else nextQuestion()
      } else {
          wx.showToast({ title: 'Please select an answer', icon: 'none' })
      }
  }, Theme.primaryTxt, 16, false, contentTop + scrollOffset + innerY)
  
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
    context.shadowBlur = 12
    context.shadowColor = Theme.shadow
    context.shadowOffsetY = 2
    drawRoundedRect(context, x, y, w, h, 12, true, false)
    context.shadowBlur = 0
    context.shadowOffsetY = 0
}

function drawButton(x, y, w, h, bg, text, subtext, interactive, callback, textColor = '#fff', fontSize = 16, isFixed = false, screenY = null, borderColor = null) {
  context.fillStyle = bg
  
  if (borderColor) {
      context.strokeStyle = borderColor
      context.lineWidth = 1
  }
  
  // Ghost button logic: if bg is transparent, don't fill unless we want hit area? 
  // Actually drawRoundedRect handles fill if 'bg' is passed. 
  // If bg is 'transparent', fill is transparent.
  
  drawRoundedRect(context, x, y, w, h, 10, true, !!borderColor)
  
  context.fillStyle = textColor
  context.font = `bold ${fontSize}px sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  
  if (subtext) {
    context.fillText(text, x + w / 2, y + h / 2 - 8)
    context.fillStyle = Theme.textSub
    context.font = '12px sans-serif'
    context.fillText(subtext, x + w / 2, y + h / 2 + 12)
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
      const testLine = line + words[n] + ' '
      const metrics = context.measureText(testLine)
      const testWidth = metrics.width
      if (testWidth > maxWidth && n > 0) {
        lines.push(line)
        line = words[n] + ' '
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
