// 搜尋目標頁面
const TARGET_PAGES = [
    "https://forum.gamer.com.tw/G2.php?bsn=6784&parent=959&sn=4380&lorder=4",
    "https://forum.gamer.com.tw/G2.php?bsn=6784&parent=959&sn=4381&lorder=5",
    "https://forum.gamer.com.tw/G2.php?bsn=6784&parent=959&sn=4382&lorder=6",
    "https://forum.gamer.com.tw/G2.php?bsn=6784&parent=959&sn=4383&lorder=7",
    "https://forum.gamer.com.tw/G2.php?bsn=6784&parent=959&sn=4384&lorder=8",
    "https://forum.gamer.com.tw/G2.php?bsn=6784&parent=959&sn=4385&lorder=9",
    "https://forum.gamer.com.tw/G2.php?bsn=6784&parent=959&sn=4386&lorder=10",
    "https://forum.gamer.com.tw/G2.php?bsn=6784&parent=959&sn=4387&lorder=11",
    "https://forum.gamer.com.tw/G2.php?bsn=6784&parent=959&sn=4388&lorder=12",
    "https://forum.gamer.com.tw/G2.php?bsn=6784&parent=959&sn=4593&lorder=13"
  ];
  
  // 使用更穩定的CORS代理
  const CORS_PROXY = 'https://corsproxy.io/?';
  
  // 請求快取
  const requestCache = new Map();
  let abortController = null;
  
  // 預先載入的頁面數據
  let preloadedPages = new Map();
  
  // 頁面預載入
  function preloadPages() {
    TARGET_PAGES.forEach((url, index) => {
      fetch(`${CORS_PROXY}${encodeURIComponent(url)}`)
        .then(response => response.text())
        .then(html => {
          preloadedPages.set(url, html);
          console.log(`預載入頁面 ${index + 1} 完成`);
        })
        .catch(e => console.error(`預載入頁面 ${index + 1} 失敗:`, e));
    });
  }
  
  // 頁面載入後立即開始預載
  document.addEventListener('DOMContentLoaded', () => {
    preloadPages();
    
    const searchBtn = document.getElementById('search-button');
    const searchInput = document.getElementById('search-query');
    
    // 點擊搜尋按鈕事件
    searchBtn.addEventListener('click', executeSearch);
    
    // Enter 鍵觸發搜尋事件
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        executeSearch();
      }
    });
    
    // 封裝搜尋執行函數
    async function executeSearch() {
      const query = searchInput.value.trim();
      
      if (!query) {
        showError('請輸入搜尋關鍵字');
        return;
      }
      
      // 取消之前的請求
      if (abortController) {
        abortController.abort();
      }
      abortController = new AbortController();
      
      try {
        showLoading(`正在搜尋「${query}」...`);
        clearResults();
        
        // 使用預載數據或即時請求
        const results = await searchAllPages(query);
        
        displayResults(results, query);
        updateResultsCount(results.length, query);
      } catch (error) {
        if (error.name !== 'AbortError') {
          showError(`搜尋失敗: ${error.message}`);
        }
      } finally {
        hideLoading();
        abortController = null;
      }
    }
  });
  
  // 並行搜尋所有頁面
  async function searchAllPages(query) {
    const searchPromises = TARGET_PAGES.map((url, index) => {
      // 優先使用預載數據
      if (preloadedPages.has(url)) {
        try {
          const results = processPageContent(preloadedPages.get(url), query, index + 1);
          return Promise.resolve(results);
        } catch (e) {
          console.error(`處理預載頁面 ${index + 1} 失敗:`, e);
          return Promise.resolve([]);
        }
      }
      // 沒有預載數據則發起請求
      return searchSinglePage(url, query, index + 1)
        .catch(e => {
          console.error(`頁面 ${index + 1} 搜尋失敗:`, e);
          return [];
        });
    });
    
    const results = await Promise.all(searchPromises);
    return results.flat();
  }
  
  // 搜尋單個頁面
  async function searchSinglePage(url, query, pageNum) {
    try {
      const response = await fetch(`${CORS_PROXY}${encodeURIComponent(url)}`, {
        signal: abortController?.signal
      });
      
      if (!response.ok) throw new Error(`HTTP錯誤: ${response.status}`);
      
      const htmlContent = await response.text();
      return processPageContent(htmlContent, query, pageNum);
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error(`頁面 ${pageNum} 搜尋失敗:`, error);
      }
      return [];
    }
  }
  
  // 處理頁面內容
  function processPageContent(htmlContent, query, pageNum) {
    // 使用更快的HTML解析方式
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlContent;
    
    // 移除不需要的元素 (提升速度)
    const unwanted = tempDiv.querySelectorAll('script, style, noscript, iframe, link, meta');
    unwanted.forEach(el => el.remove());
    
    // 創建高效搜尋索引
    const textNodes = [];
    const treeWalker = document.createTreeWalker(
      tempDiv,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          // 跳過空白內容和不可見元素
          if (!node.nodeValue.trim() || 
              node.parentNode.tagName === 'SCRIPT' || 
              node.parentNode.tagName === 'STYLE') {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    
    while (treeWalker.nextNode()) {
      textNodes.push(treeWalker.currentNode);
    }
    
    const results = [];
    const regex = new RegExp(escapeRegExp(query), 'gi');
    
    // 批量處理文本節點
    textNodes.forEach(node => {
      if (regex.test(node.nodeValue)) {
        const tbody = findClosestTbody(node);
        if (tbody) {
          const clone = tbody.cloneNode(true);
          
          // 高效高亮
          highlightMatches(clone, regex);
          
          // 快速移除不需要的行
          removeUnwantedRows(clone);
          
          results.push({
            html: clone.outerHTML,
            pageUrl: TARGET_PAGES[pageNum - 1],
            pageNum: pageNum
          });
        }
      }
    });
    
    return results;
  }
  
  // 高效高亮函數
  function highlightMatches(element, regex) {
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      { acceptNode: () => NodeFilter.FILTER_ACCEPT }
    );
    
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    
    nodes.forEach(node => {
      if (regex.test(node.nodeValue)) {
        const span = document.createElement('span');
        span.innerHTML = node.nodeValue.replace(regex, '<span class="match-text">$&</span>');
        node.parentNode.replaceChild(span, node);
      }
    });
  }
  
  // 快速移除不需要的行
  function removeUnwantedRows(tbody) {
    const rows = tbody.querySelectorAll('tr');
    rows.forEach(tr => {
      if (tr.querySelector('.userid, .edittime')) {
        tr.remove();
      }
    });
  }
  
  // 找到最近的tbody
  function findClosestTbody(node) {
    let parent = node.parentNode;
    const maxDepth = 10; // 限制搜尋深度
    
    for (let i = 0; i < maxDepth && parent; i++) {
      if (parent.tagName === 'TBODY') {
        return parent;
      }
      parent = parent.parentNode;
    }
    return null;
  }
  
  // 顯示結果
  function displayResults(results, query) {
    const container = document.getElementById('results-container');
    
    if (results.length === 0) {
      container.innerHTML = '<div class="no-results">沒有找到匹配的內容</div>';
      return;
    }
    
    // 使用DocumentFragment提升DOM操作性能
    const fragment = document.createDocumentFragment();
    
    results.forEach(result => {
      const resultItem = document.createElement('div');
      resultItem.className = 'result-item';
      resultItem.innerHTML = `
        <table class="baha-table">
          ${result.html}
          <tr>
            <td colspan="2" class="page-source">
              來源: <a href="${result.pageUrl}" target="_blank">第 ${result.pageNum} 頁</a>
            </td>
          </tr>
        </table>
      `;
      fragment.appendChild(resultItem);
    });
    
    container.innerHTML = '';
    container.appendChild(fragment);
    
    // 延遲處理圖片修復
    setTimeout(() => {
      container.querySelectorAll('img').forEach(img => {
        if (!img.src.startsWith('http')) {
          img.src = 'https://forum.gamer.com.tw' + (img.src.startsWith('/') ? '' : '/') + img.src;
        }
      });
    }, 0);
  }
  
  // 輔助函數
  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  
  function showLoading(message) {
    document.getElementById('results-count').textContent = message;
    document.getElementById('loading-spinner').classList.remove('hidden');
  }
  
  function hideLoading() {
    document.getElementById('loading-spinner').classList.add('hidden');
  }
  
  function clearResults() {
    document.getElementById('results-container').innerHTML = '';
  }
  
  function updateResultsCount(count, query) {
    const msg = count > 0 
      ? `找到 ${count} 個包含「${query}」的結果` 
      : `沒有找到包含「${query}」的結果`;
    document.getElementById('results-count').textContent = msg;
  }
  
  function showError(message) {
    document.getElementById('results-container').innerHTML = `
      <div class="error">${message}</div>
    `;
  }