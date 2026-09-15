import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './home.css'
import App from './App.tsx'

const container = document.getElementById('root')!

// index.html 里给搜索引擎 / 无 JS 用户放了一段静态首页正文。React 接管前先清掉，
// 否则不执行 JS 时是正文、执行 JS 时可能和应用重复。
container.replaceChildren()

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
