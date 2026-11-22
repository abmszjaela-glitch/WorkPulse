import base from './playwright.config.js'
export default {...base,testMatch:'profile-persistence.spec.js',reporter:'list',use:{...base.use,baseURL:'http://127.0.0.1:4176',trace:'off'},webServer:{command:'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4176 --strictPort',url:'http://127.0.0.1:4176',reuseExistingServer:false,timeout:30000}}
