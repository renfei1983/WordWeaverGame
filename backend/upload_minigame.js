const ci = require('miniprogram-ci')
const path = require('path')
const fs = require('fs')

;(async () => {
  const projectPath = path.resolve(__dirname, '../minigame')
  const privateKeyPath = path.resolve(__dirname, '../private.wx13922e8b755b1ece.key')
  
  // Check if key exists
  if (!fs.existsSync(privateKeyPath)) {
      console.error('Error: Private key not found at ' + privateKeyPath)
      process.exit(1)
  }

  console.log('Project Path:', projectPath)
  console.log('Key Path:', privateKeyPath)

  const project = new ci.Project({
    appid: 'wx13922e8b755b1ece',
    type: 'miniGame',
    projectPath: projectPath,
    privateKeyPath: privateKeyPath,
    ignores: ['node_modules/**/*'],
  })

  console.log('Uploading Minigame...')
  try {
    const uploadResult = await ci.upload({
    project,
    version: '1.9.0',
    desc: 'Deployed via Trae IDE - 2026 AI Standard Update (v1.9.0)',
    setting: {
      es6: true
    }
  })
        minify: true,
        autoPrefixWXSS: true,
        minifyWXML: true,
        minifyWXSS: true,
        minifyJS: true
        },
        onProgressUpdate: console.log,
    })
    console.log('Upload Result:', uploadResult)
  } catch (err) {
      console.error('Upload Failed:', err)
      process.exit(1)
  }
})()
