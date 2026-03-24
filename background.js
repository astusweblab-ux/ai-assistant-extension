// background.js — Service Worker
// Использует встроенный Prompt API (Gemini Nano)

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'ask-ai',
    title: 'Спросить AI',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'ask-ai' && info.selectionText) {
    await chrome.sidePanel.open({ tabId: tab.id });
    setTimeout(() => {
      chrome.runtime.sendMessage({
        type: 'CONTEXT_MENU_TEXT',
        text: info.selectionText.trim()
      }).catch(() => {
        chrome.storage.session.set({ pendingContextText: info.selectionText.trim() });
      });
    }, 600);
  }
});

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

function extractPageText() {
  const clone = document.body.cloneNode(true);
  ['script','style','nav','footer','header','aside','iframe']
    .forEach(s => clone.querySelectorAll(s).forEach(e => e.remove()));
  const main = clone.querySelector('main,article,[role="main"],.content,#content');
  const text = (main || clone).innerText || '';
  return text.replace(/\s+/g,' ').trim().slice(0, 3000);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_PAGE_TEXT') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]) { sendResponse({ error: 'Нет активной вкладки' }); return; }
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: extractPageText
        });
        sendResponse({ text: results[0].result });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    });
    return true;
  }
});
