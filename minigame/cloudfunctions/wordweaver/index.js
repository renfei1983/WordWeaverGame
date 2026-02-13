// 云函数入口文件
const cloud = require('wx-server-sdk')
const axios = require('axios')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境
const db = cloud.database()
const _ = db.command

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const appid = wxContext.APPID
  
  const { action, data } = event
  
  console.log(`Action: ${action}, OpenID: ${openid}`)

  // 1. Login (Get OpenID)
  if (action === 'login') {
      return {
          openid: openid,
          appid: appid,
          env: cloud.DYNAMIC_CURRENT_ENV
      }
  }

  // 2. Submit Quiz Result
  if (action === 'submit_quiz') {
      const { score, level, topic, userInfo } = data
      
      try {
          // Add to history
          await db.collection('quiz_history').add({
              data: {
                  _openid: openid, // Automatically added, but good for clarity
                  score: Number(score),
                  level: level,
                  topic: topic,
                  userInfo: userInfo || {}, // { nickname: '...', avatarUrl: '...' }
                  created_at: db.serverDate(),
                  timestamp: new Date().toISOString()
              }
          })
          return { status: 'success' }
      } catch (err) {
          console.error(err)
          return { status: 'fail', error: err }
      }
  }

  // 3. Get User History (Learning Records)
  if (action === 'get_history') {
      try {
          // Fetch from learning_records instead of quiz_history
          const res = await db.collection('learning_records')
              .where({
                  _openid: openid
              })
              .orderBy('created_at', 'desc')
              .limit(20)
              .get()
          
          // Flatten words list from records
          // Each record has { words: [{word, meaning}, ...], created_at }
          let history = []
          res.data.forEach(record => {
              if (record.words && Array.isArray(record.words)) {
                  record.words.forEach(w => {
                      history.push({
                          word: w.word,
                          meaning: w.meaning,
                          date: record.created_at
                      })
                  })
              }
          })
          
          return { data: history }
      } catch (err) {
          console.error(err)
          return { data: [] }
      }
  }

  // 4. Get Leaderboard (Aggregated)
  if (action === 'get_leaderboard') {
      const { type } = data // 'daily', 'weekly', 'total'
      try {
          const $ = db.command.aggregate
          let matchCondition = {}
          
          const now = new Date()
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
          
          if (type === 'daily') {
              matchCondition = { created_at: _.gte(today) }
          } else if (type === 'weekly') {
              const day = now.getDay() || 7 // Get current day number, converting Sun (0) to 7
              if( day !== 1 ) now.setHours(-24 * (day - 1)); // Set to Monday of this week
              now.setHours(0,0,0,0);
              matchCondition = { created_at: _.gte(now) }
          }
          
          // Use Aggregation Pipeline
          const res = await db.collection('quiz_history').aggregate()
              .match(matchCondition)
              .group({
                  _id: '$_openid',
                  totalScore: $.sum('$score'),
                  userInfo: $.first('$userInfo') // Keep the latest userInfo (approximation)
              })
              .sort({
                  totalScore: -1
              })
              .limit(20)
              .end()
              
          // Map to format
          const leaderboard = res.list.map((item, index) => ({
              rank: index + 1,
              username: item.userInfo && item.userInfo.nickName ? item.userInfo.nickName : ('User ' + item._id.substr(0, 4)),
              score: item.totalScore,
              level: 'N/A' // Level isn't meaningful in aggregate
          }))
          
          return { data: leaderboard }
      } catch (err) {
          console.error(err)
          return { data: [] }
      }
  }

  // 5. Record Learning (Words)
  if (action === 'record_learning') {
      const { words, source_level, topic } = data
      try {
          await db.collection('learning_records').add({
              data: {
                  _openid: openid,
                  words: words, // Array of { word, meaning }
                  source_level: source_level,
                  topic: topic,
                  created_at: db.serverDate()
              }
          })
          return { status: 'success' }
      } catch (err) {
          console.error(err)
          return { status: 'fail', error: err }
      }
  }

  // 6. Text to Speech Fallback (Edge-TTS + Cloud Storage)
  if (action === 'text_to_speech') {
      const { text } = data
      try {
          // Use edge-tts-universal
          const { Communicate } = require('edge-tts-universal')
          const voice = 'en-US-ChristopherNeural' 
          
          const communicate = new Communicate(text.slice(0, 1000), { voice: voice })
          const buffers = []
          
          // Stream generation
          for await (const chunk of communicate.stream()) {
              if (chunk.type === 'audio' && chunk.data) {
                  buffers.push(chunk.data)
              }
          }
          
          const audioBuffer = Buffer.concat(buffers)
          
          // Upload to Cloud Storage
          // This avoids the 6MB cloud function payload limit and is more stable
          const cloudPath = `tts/speech_${Date.now()}_${Math.random().toString(36).slice(-6)}.mp3`
          
          const uploadRes = await cloud.uploadFile({
              cloudPath: cloudPath,
              fileContent: audioBuffer,
          })
          
          return {
              fileID: uploadRes.fileID,
              message: 'Success'
          }
      } catch (err) {
          console.error('TTS Error:', err)
          return { error: 'TTS Failed', details: err.message }
      }
  }

  return { error: 'Unknown action' }
}