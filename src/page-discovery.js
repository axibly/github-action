const fetch = require('node-fetch');
const { JSDOM } = require('jsdom');
const xml2js = require('xml2js');
const { URL } = require('url');

/**
 * Discovers pages to scan from web applications
 * Supports multiple strategies: single page, sitemap, crawling, manual paths
 */
class PageDiscovery {
  constructor(config = {}) {
    this.maxPages = config.maxPages || 10;
    this.timeout = config.timeout || 10000;
    this.userAgent = 'ADA-Platform-Page-Discovery/1.0';
    this.visited = new Set();
    this.discovered = [];
  }

  /**
   * Discover pages using the specified strategy
   * @param {string} baseUrl - Base URL of the application
   * @param {string} strategy - Discovery strategy (single, sitemap, crawl, paths)
   * @param {object} options - Additional options
   * @returns {Promise<string[]>} Array of page paths to scan
   */
  async discoverPages(baseUrl, strategy = 'single', options = {}) {
    console.log(`🔍 Discovering pages using strategy: ${strategy}`);
    
    try {
      let pages = [];
      
      switch (strategy.toLowerCase()) {
        case 'single':
          pages = ['/'];
          break;
          
        case 'sitemap':
          pages = await this.discoverFromSitemap(baseUrl);
          break;
          
        case 'crawl':
          pages = await this.discoverByCrawling(baseUrl, options);
          break;
          
        case 'paths':
          pages = this.parseManualPaths(options.paths || []);
          break;
          
        default:
          console.warn(`⚠️  Unknown strategy '${strategy}', falling back to single page`);
          pages = ['/'];
      }

      // Normalize and deduplicate paths
      pages = this.normalizePaths(pages);
      
      // Limit number of pages
      if (pages.length > this.maxPages) {
        console.log(`📊 Limiting ${pages.length} discovered pages to ${this.maxPages}`);
        pages = pages.slice(0, this.maxPages);
      }

      console.log(`✅ Discovered ${pages.length} pages to scan:`, pages);
      return pages;

    } catch (error) {
      console.error(`❌ Page discovery failed: ${error.message}`);
      console.log('📋 Falling back to single page scan');
      return ['/'];
    }
  }

  /**
   * Discover pages from sitemap.xml
   */
  async discoverFromSitemap(baseUrl) {
    console.log('📄 Looking for sitemap.xml...');
    
    const sitemapUrls = [
      '/sitemap.xml',
      '/sitemap_index.xml',
      '/sitemap/sitemap.xml',
      '/sitemaps/sitemap.xml'
    ];

    for (const sitemapPath of sitemapUrls) {
      try {
        const sitemapUrl = `${baseUrl}${sitemapPath}`;
        console.log(`🔗 Checking ${sitemapUrl}`);
        
        const response = await fetch(sitemapUrl, {
          timeout: this.timeout,
          headers: { 'User-Agent': this.userAgent }
        });

        if (!response.ok) {
          console.log(`⚠️  Sitemap not found at ${sitemapPath} (${response.status})`);
          continue;
        }

        const sitemapXml = await response.text();
        const pages = await this.parseSitemap(sitemapXml, baseUrl);
        
        if (pages.length > 0) {
          console.log(`📄 Found sitemap at ${sitemapPath} with ${pages.length} pages`);
          return pages;
        }

      } catch (error) {
        console.log(`⚠️  Error fetching sitemap at ${sitemapPath}: ${error.message}`);
      }
    }

    throw new Error('No valid sitemap found');
  }

  /**
   * Parse sitemap XML and extract URLs
   */
  async parseSitemap(sitemapXml, baseUrl) {
    const parser = new xml2js.Parser();
    
    try {
      const result = await parser.parseStringPromise(sitemapXml);
      const pages = [];
      const baseUrlObj = new URL(baseUrl);

      // Handle regular sitemap
      if (result.urlset && result.urlset.url) {
        for (const urlEntry of result.urlset.url) {
          if (urlEntry.loc && urlEntry.loc[0]) {
            const url = new URL(urlEntry.loc[0]);
            
            // Only include URLs from the same host
            if (url.hostname === baseUrlObj.hostname) {
              pages.push(url.pathname);
            }
          }
        }
      }
      
      // Handle sitemap index
      if (result.sitemapindex && result.sitemapindex.sitemap) {
        console.log('📑 Found sitemap index, processing child sitemaps...');
        
        for (const sitemapEntry of result.sitemapindex.sitemap) {
          if (sitemapEntry.loc && sitemapEntry.loc[0]) {
            try {
              const childSitemapUrl = sitemapEntry.loc[0];
              const response = await fetch(childSitemapUrl, {
                timeout: this.timeout,
                headers: { 'User-Agent': this.userAgent }
              });
              
              if (response.ok) {
                const childSitemapXml = await response.text();
                const childPages = await this.parseSitemap(childSitemapXml, baseUrl);
                pages.push(...childPages);
              }
            } catch (error) {
              console.warn(`⚠️  Error processing child sitemap: ${error.message}`);
            }
          }
        }
      }

      return pages;

    } catch (error) {
      throw new Error(`Failed to parse sitemap: ${error.message}`);
    }
  }

  /**
   * Discover pages by crawling the website
   */
  async discoverByCrawling(baseUrl, options = {}) {
    console.log('🕷️  Starting website crawl...');
    
    const maxPages = Math.min(options.maxPages || this.maxPages, 50); // Cap crawling
    const startPaths = options.startPaths || ['/'];
    
    this.visited.clear();
    this.discovered = [];
    
    const toVisit = [...startPaths];
    const baseUrlObj = new URL(baseUrl);

    while (toVisit.length > 0 && this.discovered.length < maxPages) {
      const path = toVisit.shift();
      
      if (this.visited.has(path)) {
        continue;
      }

      try {
        console.log(`🔍 Crawling: ${path}`);
        this.visited.add(path);
        this.discovered.push(path);

        // Get links from this page
        const pageUrl = `${baseUrl}${path}`;
        const links = await this.extractLinksFromPage(pageUrl, baseUrlObj);
        
        // Add new links to visit queue
        for (const link of links) {
          if (!this.visited.has(link) && !toVisit.includes(link)) {
            toVisit.push(link);
          }
        }

        // Add small delay to be respectful
        await this.sleep(200);

      } catch (error) {
        console.warn(`⚠️  Error crawling ${path}: ${error.message}`);
      }
    }

    console.log(`🕷️  Crawling completed: found ${this.discovered.length} pages`);
    return this.discovered;
  }

  /**
   * Extract links from a web page
   */
  async extractLinksFromPage(pageUrl, baseUrlObj) {
    try {
      const response = await fetch(pageUrl, {
        timeout: this.timeout,
        headers: { 
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml'
        }
      });

      if (!response.ok) {
        return [];
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) {
        return [];
      }

      const html = await response.text();
      const dom = new JSDOM(html);
      const document = dom.window.document;

      const links = [];
      const anchorElements = document.querySelectorAll('a[href]');

      for (const anchor of anchorElements) {
        const href = anchor.getAttribute('href');
        
        if (!href) continue;

        // Skip external links, anchors, javascript, mailto, etc.
        if (this.shouldSkipLink(href)) {
          continue;
        }

        try {
          // Handle relative URLs
          let linkUrl;
          if (href.startsWith('/')) {
            linkUrl = new URL(href, baseUrlObj);
          } else if (href.startsWith('http')) {
            linkUrl = new URL(href);
          } else {
            linkUrl = new URL(href, pageUrl);
          }

          // Only include links from the same host
          if (linkUrl.hostname === baseUrlObj.hostname) {
            const path = linkUrl.pathname;
            
            // Normalize path
            const normalizedPath = path.endsWith('/') && path !== '/' 
              ? path.slice(0, -1) 
              : path;
              
            if (normalizedPath && !links.includes(normalizedPath)) {
              links.push(normalizedPath);
            }
          }

        } catch (error) {
          // Invalid URL, skip
        }
      }

      return links;

    } catch (error) {
      console.warn(`⚠️  Error extracting links from ${pageUrl}: ${error.message}`);
      return [];
    }
  }

  /**
   * Check if a link should be skipped during crawling
   */
  shouldSkipLink(href) {
    const skipPatterns = [
      /^#/,                    // Anchor links
      /^javascript:/,          // JavaScript links
      /^mailto:/,              // Email links
      /^tel:/,                 // Phone links
      /^ftp:/,                 // FTP links
      /\.(pdf|jpg|jpeg|png|gif|svg|ico|zip|tar|gz)$/i,  // File downloads
      /\/admin/,               // Admin paths
      /\/api\//,               // API endpoints
      /\/logout/,              // Logout links
      /\/download/,            // Download pages
    ];

    return skipPatterns.some(pattern => pattern.test(href));
  }

  /**
   * Parse manually specified paths
   */
  parseManualPaths(pathsInput) {
    let paths = [];

    if (typeof pathsInput === 'string') {
      // Split by newlines and filter empty lines
      paths = pathsInput
        .split('\n')
        .map(path => path.trim())
        .filter(path => path && !path.startsWith('#'));
    } else if (Array.isArray(pathsInput)) {
      paths = pathsInput.filter(path => path && typeof path === 'string');
    }

    console.log(`📝 Using ${paths.length} manually specified paths`);
    return paths;
  }

  /**
   * Normalize and deduplicate paths
   */
  normalizePaths(paths) {
    const normalized = new Set();

    for (const path of paths) {
      if (!path || typeof path !== 'string') {
        continue;
      }

      // Ensure path starts with /
      let normalizedPath = path.startsWith('/') ? path : '/' + path;
      
      // Remove trailing slash (except for root)
      if (normalizedPath !== '/' && normalizedPath.endsWith('/')) {
        normalizedPath = normalizedPath.slice(0, -1);
      }

      // Remove query parameters and fragments for scanning
      const urlParts = normalizedPath.split(/[?#]/);
      normalizedPath = urlParts[0];

      normalized.add(normalizedPath);
    }

    // Convert to array and sort
    const result = Array.from(normalized).sort();
    
    // Ensure root path comes first
    const rootIndex = result.indexOf('/');
    if (rootIndex > 0) {
      result.splice(rootIndex, 1);
      result.unshift('/');
    }

    return result;
  }

  /**
   * Sleep for specified milliseconds
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get discovery statistics
   */
  getStats() {
    return {
      visited: this.visited.size,
      discovered: this.discovered.length,
      maxPages: this.maxPages
    };
  }
}

module.exports = PageDiscovery;