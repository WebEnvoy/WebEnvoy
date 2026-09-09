// Dedicated local acceptance page: no Runtime connection, credentials or business effects.
import { createServer } from 'node:http';
const port = Number(process.argv[2] ?? 18794);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a dedicated unprivileged port');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>受控浏览器交互验证</title>
<style>body{font:20px system-ui;max-width:800px;margin:40px auto;padding:20px}label{display:block;margin:24px 0}input,textarea,button{font:inherit;padding:10px}label input,label textarea{display:block;margin-top:8px}button{margin:10px}section{border:1px solid #888;padding:24px}.space{height:1200px}</style>
<main><h1>受控浏览器交互验证</h1><p>此页面仅在当前浏览器处理非敏感测试内容，不发送请求或产生业务效果。</p>
<label>关键词<input name="condition" autocomplete="off"></label>
<label>键盘确认<input name="keyboard" autocomplete="off" placeholder="输入后按 Enter 确认"></label>
<label>备注<textarea name="note" rows="2"></textarea></label>
<button name="apply" disabled>应用条件</button><button name="reset">清空条件</button>
<p role="status" aria-live="polite">请填写关键词并用 Enter 确认键盘字段。</p>
<div class="space" aria-hidden="true"></div><section aria-label="验证结果"><h2>验证结果</h2><p id="result">尚未生成结果</p><p id="count">应用次数：0</p></section></main>
<script>
const condition=document.querySelector('[name=condition]'),keyboard=document.querySelector('[name=keyboard]'),note=document.querySelector('[name=note]'),apply=document.querySelector('[name=apply]'),status=document.querySelector('[role=status]');
let confirmed='',count=0;
keyboard.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();confirmed=keyboard.value;status.textContent='键盘事件已收到，正在校验。';apply.disabled=true;setTimeout(()=>{apply.disabled=!(condition.value.trim()&&confirmed);status.textContent=apply.disabled?'请先填写关键词。':'校验完成，可以应用条件。';},1500);}});
keyboard.addEventListener('input',()=>{confirmed='';apply.disabled=true;});
condition.addEventListener('input',()=>{apply.disabled=true;});
apply.addEventListener('click',()=>{count++;document.querySelector('#result').textContent='关键词：'+condition.value+'；键盘确认：'+confirmed+'；备注：'+note.value;document.querySelector('#count').textContent='应用次数：'+count;status.textContent='结果已生成，请向下滚动核对。';});
document.querySelector('[name=reset]').addEventListener('click',()=>{condition.value='';keyboard.value='';note.value='';confirmed='';apply.disabled=true;status.textContent='条件已清空，请重新输入。';});
</script></html>`;
const server = createServer((request, response) => {
  if (request.headers.host !== `127.0.0.1:${port}` || request.method !== 'GET' || !['/', '/interaction'].includes(request.url)) {
    response.writeHead(404).end(); return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; frame-src 'none'; base-uri 'none'" });
  response.end(html);
});
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ origin: `http://127.0.0.1:${port}`, controlled_page: true })));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
