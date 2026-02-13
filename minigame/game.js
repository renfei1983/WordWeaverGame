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
const BACKEND_VERSION = 'v1.3.0'

// --- Constants ---
const LEVELS = ['Primary School', 'KET', 'PET', 'Junior High', 'Senior High', 'Postgraduate']
const TOPICS = ['Daily Life', 'Science', 'Art', 'Harry Potter', 'Avengers', 'Minecraft']

// --- Theme Configuration (Clean White Style) ---
const Theme = {
  bg: '#F8FAFC',       // Slate 50 (Very light gray/white)
  bgTrans: 'rgba(255, 255, 255, 0.95)',
  surface: '#FFFFFF',  // White
  primary: '#0EA5E9',  // Sky 500 (Clean Blue)
  primaryHover: '#38BDF8', // Sky 400
  secondary: '#E2E8F0', // Slate 200 (Light gray for borders/dividers)
  textMain: '#1E293B', // Slate 800 (Dark gray text)
  textSub: '#64748B',  // Slate 500 (Medium gray text)
  accent: '#F59E0B',   // Amber 500 (Orange accent)
  success: '#10B981',  // Emerald 500
  error: '#EF4444',    // Red 500
  border: '#CBD5E1'    // Slate 300
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
  }, Theme.textMain, 22)

  drawButton(30, startY + 110, btnW, btnH, Theme.secondary, 'MathMind', 'Coming Soon', false, null, Theme.textSub, 22)
}

function drawWordWeaverHub(w, h) {
    // Header
    const headerY = safeAreaTop
    context.fillStyle = Theme.surface
    context.fillRect(0, 0, w, safeAreaTop + headerHeight)
    
    // Back Button
    const backBtnH = 36
    drawButton(10, headerY + (headerHeight - backBtnH)/2, 80, backBtnH, 'transparent', '< Back', '', true, () => {
        currentScene = 'hub'
        draw()
    }, Theme.primary, 16, true)

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
    
    context.fillStyle = Theme.surface
    context.fillRect(0, tabY, w, tabBarHeight)
    
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
            context.fillRect(x + 10, tabY + tabBarHeight - 3, tabW - 20, 3)
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
    
    // Level Selection
    context.fillStyle = Theme.textMain
    context.font = 'bold 18px sans-serif'
    context.textAlign = 'left'
    context.fillText('Select Level', 20, y)
    y += 30
    
    const gridCols = 2
    const cellW = (w - 60) / gridCols
    const cellH = 50
    
    LEVELS.forEach((level, i) => {
        const row = Math.floor(i / gridCols)
        const col = i % gridCols
        const lx = 20 + col * (cellW + 20)
        const ly = y + row * (cellH + 15)
        
        const isSelected = selectedLevel === level
        drawButton(lx, ly, cellW, cellH, isSelected ? Theme.primary : Theme.surface, level, '', true, () => {
            selectedLevel = level
            draw()
        }, isSelected ? Theme.textMain : Theme.textSub, 14, false, contentTop + scrollOffset + ly)
    })
    y += Math.ceil(LEVELS.length / gridCols) * (cellH + 15) + 20
    
    // Topic Selection
    context.fillStyle = Theme.textMain
    context.font = 'bold 18px sans-serif'
    context.textAlign = 'left'
    context.fillText('Select Topic', 20, y)
    y += 30
    
    TOPICS.forEach((topic, i) => {
        const row = Math.floor(i / gridCols)
        const col = i % gridCols
        const tx = 20 + col * (cellW + 20)
        const ty = y + row * (cellH + 15)
        
        const isSelected = selectedTopic === topic
        drawButton(tx, ty, cellW, cellH, isSelected ? Theme.accent : Theme.surface, topic, '', true, () => {
            selectedTopic = topic
            draw()
        }, isSelected ? Theme.surface : Theme.textSub, 14, false, contentTop + scrollOffset + ty)
    })
    y += Math.ceil(TOPICS.length / gridCols) * (cellH + 15) + 40
    
    // Start Button
    drawButton(40, y, w - 80, 60, Theme.success, 'Start Quiz', 'Create Story', true, () => {
        currentScene = 'game'
        startNewGame()
    }, Theme.textMain, 20, false, contentTop + scrollOffset + y)
    
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
        drawRoundedRect(context, 20, y, w - 40, 80, 10, true, true)
        
        context.fillStyle = Theme.primary
        context.font = 'bold 16px sans-serif'
        context.textAlign = 'left'
        context.fillText(item.topic, 35, y + 30)
        
        context.fillStyle = Theme.textSub
        context.font = '14px sans-serif'
        context.fillText(item.level, 35, y + 55)
        
        context.fillStyle = Theme.accent
        context.font = 'bold 20px sans-serif'
        context.textAlign = 'right'
        context.fillText(`+${item.score}`, w - 35, y + 45)
        
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
        
        drawButton(tx, y, subTabW, 40, isSel ? Theme.primary : Theme.surface, t.toUpperCase(), '', true, () => {
            rankType = t
            fetchLeaderboard()
        }, isSel ? Theme.textMain : Theme.textSub, 12, false, contentTop + scrollOffset + y)
    })
    y += 60
    
    // Header
    context.fillStyle = Theme.textSub
    context.font = '12px sans-serif'
    context.textAlign = 'left'
    context.fillText('RANK', 30, y)
    context.fillText('USER', 80, y)
    context.textAlign = 'right'
    context.fillText('SCORE', w - 30, y)
    
    context.fillStyle = Theme.border
    context.fillRect(20, y + 10, w - 40, 1)
    y += 20
    
    if (isHubLoading) {
        context.fillStyle = Theme.textSub
        context.font = '16px sans-serif'
        context.textAlign = 'center'
        context.fillText('Loading rankings...', w/2, y + 50)
        return y + 100
    }

    if (leaderboardData.length === 0) {
        context.textAlign = 'center'
        context.fillText('Loading...', w/2, y + 50)
        return y + 100
    }
    
    leaderboardData.forEach(item => {
        context.fillStyle = Theme.surface
        drawRoundedRect(context, 20, y, w - 40, 50, 8, true, true)
        
        // Rank
        context.fillStyle = item.rank <= 3 ? Theme.accent : Theme.textSub
        context.font = 'bold 16px sans-serif'
        context.textAlign = 'center'
        context.fillText(item.rank, 40, y + 30)
        
        // User
        context.fillStyle = Theme.textMain
        context.textAlign = 'left'
        context.fillText(item.username.slice(0, 10), 80, y + 30)
        
        // Score
        context.fillStyle = Theme.primary
        context.textAlign = 'right'
        context.fillText(item.score, w - 40, y + 30)
        
        y += 60
    })
    
    return y + 20
}

function drawGameScene(w, h) {
  const headerY = safeAreaTop
  context.fillStyle = Theme.surface
  context.fillRect(0, 0, w, safeAreaTop + headerHeight)
  
  const backBtnH = 36
  drawButton(10, headerY + (headerHeight - backBtnH)/2, 80, backBtnH, 'transparent', '< Hub', '', true, () => {
    currentScene = 'wordweaver'
    hubTab = 'SELECTION'
    audioCtx.stop()
    draw()
  }, Theme.primary, 16, true)
  
  context.fillStyle = Theme.textMain
  context.font = 'bold 18px sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText('WordWeaver', w / 2, headerY + headerHeight/2)
  
  context.fillStyle = Theme.border
  context.fillRect(0, safeAreaTop + headerHeight - 1, w, 1)

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
  
  context.fillStyle = Theme.surface
  context.fillRect(0, startY, w, tabBarHeight)
  
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
      context.fillRect(x + 10, startY + tabBarHeight - 3, tabW - 20, 3)
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
  
  context.fillStyle = Theme.border
  context.fillRect(0, startY + tabBarHeight - 1, w, 1)
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
  context.fillStyle = Theme.primary
  context.font = 'bold 14px sans-serif'
  context.textAlign = 'left'
  context.fillText(`Topic: ${selectedTopic} | Level: ${selectedLevel}`, 20, y)
  y += 30
  
  const text = storyData.content || ''
  const lines = wrapText(context, text, w - 40, 18)
  
  context.textAlign = 'left'
  context.textBaseline = 'alphabetic'
  const lineHeight = 30
  
  lines.forEach(line => {
    let currentX = 20
    const parts = line.split(/(\*\*.*?\*\*)/g)
    parts.forEach(part => {
      if (part.startsWith('**') && part.endsWith('**')) {
        context.font = 'bold 18px sans-serif'
        context.fillStyle = Theme.primary
        const word = part.slice(2, -2)
        context.fillText(word, currentX, y)
        currentX += context.measureText(word).width
      } else {
        context.font = '18px sans-serif'
        context.fillStyle = Theme.textMain
        context.fillText(part, currentX, y)
        currentX += context.measureText(part).width
      }
    })
    y += lineHeight
  })
  return y + 40
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
      context.fillStyle = Theme.surface
      context.strokeStyle = Theme.border
      context.lineWidth = 1
      drawRoundedRect(context, 20, y, w - 40, 90, 12, true, true)
      
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
  
  drawButton(20, y, 160, btnH, showTranslation ? Theme.secondary : Theme.success, 
    showTranslation ? 'Hide' : 'Show Translation', '', true, 
    () => { showTranslation = !showTranslation; draw() }, Theme.textMain, 16, false, screenY)
    
  y += 60
  if (showTranslation && storyData.translation) {
    const lines = wrapText(context, storyData.translation, w - 40, 16)
    context.fillStyle = Theme.textSub
    context.font = '16px sans-serif'
    context.textAlign = 'left'
    lines.forEach(line => {
      context.fillText(line, 20, y)
      y += 28
    })
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
  
  context.fillStyle = Theme.textSub
  context.font = '14px sans-serif'
  context.textAlign = 'center'
  context.fillText(`Question ${quizIndex + 1} of ${storyData.quiz.length}`, w/2, y)
  y += 30
  
  context.fillStyle = Theme.textMain
  context.font = 'bold 18px sans-serif'
  context.textAlign = 'left'
  const lines = wrapText(context, q.question, w - 40, 18)
  lines.forEach(line => {
    context.fillText(line, 20, y)
    y += 28
  })
  y += 20
  
  const screenY = contentTop + scrollOffset + y
  
  q.options.forEach(opt => {
    let bgColor = Theme.surface
    let txtColor = Theme.textMain
    let borderColor = Theme.border
    
    if (quizAnswered) {
      if (opt === q.answer) {
        bgColor = 'rgba(16, 185, 129, 0.2)'
        borderColor = Theme.success
        txtColor = Theme.success
      } else if (opt === quizSelectedOption) {
        bgColor = 'rgba(239, 68, 68, 0.2)'
        borderColor = Theme.error
        txtColor = Theme.error
      }
    }
    
    drawButton(20, y, w - 40, 50, bgColor, opt, '', true, () => handleAnswer(opt), txtColor, 16, false, screenY)
    
    // Draw Border manually since drawButton is simple
    context.strokeStyle = borderColor
    context.lineWidth = 1
    drawRoundedRect(context, 20, y, w - 40, 50, 10, false, true)
    
    y += 65
  })
  
  y += 20
  // Next / Skip Button
  const btnW = (w - 60) / 2
  const isLast = quizIndex === storyData.quiz.length - 1
  
  // Skip Button (Left)
  if (!isLast) {
      drawButton(20, y, btnW, 44, Theme.secondary, '跳过', '', true, () => {
          skipQuestion()
      }, Theme.textMain, 16, false, screenY)
  }
  
  // Next/Finish Button (Right)
  // If answered, show "Next" or "Finish"
  // If not answered, show "Next" (which acts as check? No, user asked for skip)
  // We'll show "下一题" (Next Question)
  
  const nextLabel = isLast ? '完成' : '下一题'
  const nextBg = quizAnswered ? Theme.primary : Theme.primary // Always primary? Or disabled if not answered?
  // User said "Can skip", so maybe Next is just Next.
  // But typically Next implies "Submit" if not answered?
  // Current logic: if answered next(), else skip().
  // With separate buttons:
  // Skip -> skipQuestion()
  // Next -> if answered next(), else... toast "Please answer"?
  
  const rightBtnX = isLast ? (w - 100)/2 : (w - 20 - btnW)
  const rightBtnW = isLast ? 100 : btnW
  
  drawButton(rightBtnX, y, rightBtnW, 44, Theme.primary, nextLabel, '', true, () => {
      if (quizAnswered) {
          if (isLast) finishQuiz()
          else nextQuestion()
      } else {
          // If they click Next without answering, maybe they meant to skip?
          // But we have a Skip button now.
          // So show toast "Please select an answer or click Skip"
          wx.showToast({ title: '请选择答案或点击跳过', icon: 'none' })
      }
  }, Theme.textMain, 16, false, screenY)
  
  return y + 100
}

function drawAudioPlayer(w, y, h) {
  context.fillStyle = Theme.surface
  context.fillRect(0, y, w, h)
  
  // Progress Bar
  context.fillStyle = Theme.secondary
  context.fillRect(0, y, w, 4)
  context.fillStyle = Theme.primary
  context.fillRect(0, y, w * audioProgress, 4)
  
  // Play/Pause Button
  const btnSize = 50
  const btnX = w / 2 - btnSize / 2
  const btnY = y + (h - btnSize) / 2 + 4
  
  drawButton(btnX, btnY, btnSize, btnSize, Theme.primary, isAudioPlaying ? '||' : '▶', '', true, () => toggleAudio(), Theme.textMain, 24)
}

// --- Helper Functions ---

function drawButton(x, y, w, h, bg, text, subtext, interactive, callback, textColor = '#fff', fontSize = 16, isFixed = false, screenY = null) {
  context.fillStyle = bg
  drawRoundedRect(context, x, y, w, h, 12, true, false)
  
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
