// 云函数入口文件
const cloud = require('wx-server-sdk')

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

  // 3. Get User History
  if (action === 'get_history') {
      try {
          const res = await db.collection('quiz_history')
              .where({
                  _openid: openid
              })
              .orderBy('created_at', 'desc')
              .limit(20)
              .get()
          return { data: res.data }
      } catch (err) {
          console.error(err)
          return { data: [] }
      }
  }

  // 4. Get Leaderboard (Top 20 Global)
  if (action === 'get_leaderboard') {
      try {
          // Simple Global Leaderboard: Get top 20 scores from everyone
          // Note: In a real production app with millions of records, you'd want a separate aggregated collection.
          // For now, querying the main collection sorted by score is fine for small-medium scale.
          const res = await db.collection('quiz_history')
              .orderBy('score', 'desc')
              .limit(20)
              .get()
          
          // Map to format expected by frontend
          const leaderboard = res.data.map((item, index) => ({
              rank: index + 1,
              username: item.userInfo && item.userInfo.nickName ? item.userInfo.nickName : ('User ' + item._openid.substr(0, 4)),
              score: item.score,
              level: item.level
          }))
          
          return { data: leaderboard }
      } catch (err) {
          console.error(err)
          return { data: [] }
      }
  }

  return { error: 'Unknown action' }
}