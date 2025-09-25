const express = require('express');
const { chromium, firefox, webkit } = require('playwright');
const axeCore = require('axe-core');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

/**
 * Lightweight scanner service for self-hosted CI/CD environments
 * Runs accessibility scans using Playwright and axe-core
 */
class ScannerService {
  constructor() {
    this.app = express();
    this.app.use(express.json({ limit: '10mb' }));
    
    this.browsers = {};
    this.config = this.loadConfig();
    this.scanResults = new Map();
    
    this.setupRoutes();
  }

  loadConfig() {
    return {
      port: process.env.SCANNER_PORT || 3003,
      mode: process.env.SCANNER_MODE || 'self-hosted',
      sessionToken: process.env.SESSION_TOKEN,
      accountConfig: process.env.ACCOUNT_CONFIG ? JSON.parse(process.env.ACCOUNT_CONFIG) : {},
      maxPages: parseInt(process.env.MAX_PAGES) || 10,
      wcagLevel: process.env.WCAG_LEVEL || 'AA',
      includeBestPractices: process.env.INCLUDE_BEST_PRACTICES === 'true',
      includeExperimental: process.env.INCLUDE_EXPERIMENTAL === 'true',
      reportToSaas: process.env.REPORT_TO_SAAS === 'true',
      apiUrl: process.env.API_URL || 'https://api.ada-platform.com',
      browserTimeout: parseInt(process.env.BROWSER_TIMEOUT) || 30000,
      headless: process.env.BROWSER_HEADLESS !== 'false'
    };
  }

  setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        mode: this.config.mode,
        browsers: Object.keys(this.browsers),
        timestamp: new Date().toISOString()
      });
    });

    // Scan endpoint
    this.app.post('/scan', async (req, res) => {
      try {
        const { url, options = {} } = req.body;
        
        if (!url) {
          return res.status(400).json({ error: 'URL is required' });
        }

        console.log(`🔍 Starting scan for: ${url}`);
        
        const scanId = uuidv4();
        const scanOptions = {
          ...this.config,
          ...options,
          scanId
        };

        // Start scan asynchronously
        this.performScan(url, scanOptions).catch(error => {
          console.error(`Scan failed for ${url}:`, error);
          this.scanResults.set(scanId, {
            status: 'failed',
            error: error.message
          });
        });

        res.json({
          scanId,
          status: 'started',
          url,
          message: 'Scan initiated successfully'
        });

      } catch (error) {
        console.error('Failed to start scan:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Scan status endpoint
    this.app.get('/scan/:scanId', (req, res) => {
      const { scanId } = req.params;
      const result = this.scanResults.get(scanId);
      
      if (!result) {
        return res.status(404).json({ error: 'Scan not found' });
      }
      
      res.json(result);
    });

    // Synchronous scan endpoint (for simpler CI workflows)
    this.app.post('/scan-sync', async (req, res) => {
      try {
        const { url, options = {} } = req.body;
        
        if (!url) {
          return res.status(400).json({ error: 'URL is required' });
        }

        console.log(`🔍 Starting synchronous scan for: ${url}`);
        
        const scanOptions = {
          ...this.config,
          ...options,
          scanId: uuidv4()
        };

        const result = await this.performScan(url, scanOptions);
        res.json(result);

      } catch (error) {
        console.error('Scan failed:', error);
        res.status(500).json({ 
          error: error.message,
          status: 'failed'
        });
      }
    });

    // Batch scan endpoint
    this.app.post('/scan-batch', async (req, res) => {
      try {
        const { urls, options = {} } = req.body;
        
        if (!urls || !Array.isArray(urls)) {
          return res.status(400).json({ error: 'URLs array is required' });
        }

        const batchId = uuidv4();
        const scanIds = [];

        for (const url of urls) {
          const scanId = uuidv4();
          scanIds.push(scanId);
          
          const scanOptions = {
            ...this.config,
            ...options,
            scanId,
            batchId
          };

          // Start scans asynchronously
          this.performScan(url, scanOptions).catch(error => {
            console.error(`Batch scan failed for ${url}:`, error);
            this.scanResults.set(scanId, {
              status: 'failed',
              error: error.message,
              batchId
            });
          });
        }

        res.json({
          batchId,
          scanIds,
          urls,
          status: 'started',
          message: `Batch scan initiated for ${urls.length} URLs`
        });

      } catch (error) {
        console.error('Failed to start batch scan:', error);
        res.status(500).json({ error: error.message });
      }
    });
  }

  async performScan(url, options) {
    const startTime = Date.now();
    const { scanId } = options;
    
    // Update status
    this.scanResults.set(scanId, {
      scanId,
      status: 'running',
      url,
      startTime: new Date().toISOString()
    });

    try {
      // Launch browser
      const browser = await this.getBrowser(options.browser || 'chromium');
      const context = await browser.newContext({
        viewport: options.viewport || { width: 1280, height: 720 },
        userAgent: options.userAgent,
        ignoreHTTPSErrors: true
      });

      const page = await context.newPage();
      
      // Set timeout
      page.setDefaultTimeout(this.config.browserTimeout);

      // Navigate to URL
      console.log(`📄 Navigating to: ${url}`);
      await page.goto(url, { 
        waitUntil: 'networkidle',
        timeout: this.config.browserTimeout 
      });

      // Wait for any dynamic content
      await page.waitForTimeout(2000);

      // Inject axe-core
      await page.addScriptTag({
        content: axeCore.source
      });

      // Configure axe
      const axeConfig = {
        runOnly: {
          type: 'tag',
          values: this.getAxeTags(options)
        },
        resultTypes: ['violations', 'passes', 'incomplete'],
        elementRef: true
      };

      // Run axe analysis
      console.log(`🔬 Running accessibility scan with config:`, axeConfig);
      const axeResults = await page.evaluate((config) => {
        return window.axe.run(document, config);
      }, axeConfig);

      // Enhanced data collection for SaaS analysis
      const enhancedData = await this.collectEnhancedData(page, axeResults);

      // Calculate basic score
      const score = this.calculateScore(axeResults);

      // Process results
      const scanResult = {
        scanId,
        url,
        status: 'completed',
        score,
        summary: {
          score,
          violationCount: axeResults.violations.length,
          passCount: axeResults.passes.length,
          incompleteCount: axeResults.incomplete.length,
          wcagLevel: options.wcagLevel || this.config.wcagLevel
        },
        violations: this.processViolations(axeResults.violations),
        passes: this.processPasses(axeResults.passes),
        incomplete: axeResults.incomplete,
        enhancedData: enhancedData, // Additional data for SaaS analysis
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        metadata: {
          url: axeResults.url,
          browser: options.browser || 'chromium',
          axeVersion: axeResults.testEngine?.version,
          mode: this.config.mode
        }
      };

      // Enhance results with SaaS intelligence if available
      if (this.config.sessionToken) {
        scanResult.enhancedAnalysis = await this.getEnhancedAnalysis(scanResult);
      }

      // Save results
      await this.saveResults(scanResult);
      this.scanResults.set(scanId, scanResult);

      // Cleanup
      await context.close();

      console.log(`✅ Scan completed: ${url} - Score: ${scanResult.enhancedAnalysis?.enhancedScore || score}`);
      return scanResult;

    } catch (error) {
      console.error(`❌ Scan failed for ${url}:`, error);
      const errorResult = {
        scanId,
        url,
        status: 'failed',
        error: error.message,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };
      
      this.scanResults.set(scanId, errorResult);
      throw error;
    }
  }

  getAxeTags(options) {
    const tags = [];
    
    // WCAG level
    const wcagLevel = options.wcagLevel || this.config.wcagLevel;
    if (wcagLevel === 'A') {
      tags.push('wcag2a', 'wcag21a');
    } else if (wcagLevel === 'AA') {
      tags.push('wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa');
    } else if (wcagLevel === 'AAA') {
      tags.push('wcag2a', 'wcag2aa', 'wcag2aaa', 'wcag21a', 'wcag21aa');
    }

    // Best practices
    if (options.includeBestPractices ?? this.config.includeBestPractices) {
      tags.push('best-practice');
    }

    // Experimental rules
    if (options.includeExperimental ?? this.config.includeExperimental) {
      tags.push('experimental');
    }

    return tags;
  }

  calculateScore(results) {
    const totalTests = results.passes.length + results.violations.length;
    if (totalTests === 0) return 100;

    // Weight violations by impact
    let weightedViolations = 0;
    results.violations.forEach(violation => {
      const impactWeight = {
        'critical': 4,
        'serious': 3,
        'moderate': 2,
        'minor': 1
      }[violation.impact] || 1;
      
      weightedViolations += impactWeight * violation.nodes.length;
    });

    // Calculate score (0-100)
    const maxPossibleWeight = totalTests * 4; // Assuming all could be critical
    const score = Math.round(((maxPossibleWeight - weightedViolations) / maxPossibleWeight) * 100);
    
    return Math.max(0, Math.min(100, score));
  }

  processViolations(violations) {
    return violations.map(violation => ({
      id: violation.id,
      impact: violation.impact,
      description: violation.description,
      help: violation.help,
      helpUrl: violation.helpUrl,
      tags: violation.tags,
      nodes: violation.nodes.slice(0, 10).map(node => ({ // Limit to 10 nodes
        html: node.html,
        target: node.target,
        failureSummary: node.failureSummary
      })),
      nodeCount: violation.nodes.length
    }));
  }

  processPasses(passes) {
    // Just count passes, don't store full details
    return passes.map(pass => ({
      id: pass.id,
      description: pass.description,
      nodeCount: pass.nodes.length
    }));
  }

  async saveResults(results) {
    const resultsDir = '/app/results';
    await fs.mkdir(resultsDir, { recursive: true });
    
    const filename = `scan-${results.scanId}.json`;
    const filepath = path.join(resultsDir, filename);
    
    await fs.writeFile(filepath, JSON.stringify(results, null, 2));
    console.log(`💾 Results saved to: ${filepath}`);
  }

  /**
   * Collect enhanced data for SaaS intelligence analysis
   */
  async collectEnhancedData(page, axeResults) {
    try {
      const enhancedData = {
        // Page structure analysis
        structure: await page.evaluate(() => {
          return {
            title: document.title,
            lang: document.documentElement.lang,
            headingStructure: Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
              .map((h, index) => ({
                level: parseInt(h.tagName.charAt(1)),
                text: h.textContent?.trim().substring(0, 100),
                hasId: !!h.id,
                order: index
              })),
            landmarkCount: {
              main: document.querySelectorAll('main, [role="main"]').length,
              nav: document.querySelectorAll('nav, [role="navigation"]').length,
              header: document.querySelectorAll('header, [role="banner"]').length,
              footer: document.querySelectorAll('footer, [role="contentinfo"]').length
            }
          };
        }),

        // Form analysis
        forms: await page.evaluate(() => {
          return Array.from(document.querySelectorAll('form')).map(form => ({
            id: form.id,
            method: form.method,
            action: form.action ? 'present' : 'missing', // Don't expose actual URLs
            fieldCount: form.querySelectorAll('input, select, textarea').length,
            labeledFields: form.querySelectorAll('input[id]:not([type="hidden"]), select[id], textarea[id]')
              .length,
            requiredFields: form.querySelectorAll('[required]').length,
            hasFieldset: form.querySelectorAll('fieldset').length > 0
          }));
        }),

        // Interactive elements analysis  
        interactive: await page.evaluate(() => {
          const elements = document.querySelectorAll('a, button, input, select, textarea, [tabindex], [role="button"], [role="link"]');
          return {
            totalCount: elements.length,
            focusableCount: Array.from(elements).filter(el => {
              return el.tabIndex >= 0 && !el.disabled && !el.hidden;
            }).length,
            withoutAccessibleName: Array.from(elements).filter(el => {
              const name = el.getAttribute('aria-label') || 
                          el.getAttribute('aria-labelledby') || 
                          el.textContent?.trim() ||
                          el.getAttribute('title') ||
                          el.getAttribute('alt');
              return !name;
            }).length
          };
        }),

        // Visual analysis
        visual: await page.evaluate(() => {
          return {
            colorScheme: getComputedStyle(document.documentElement).colorScheme || 'normal',
            hasHighContrast: !!window.matchMedia('(prefers-contrast: high)').matches,
            hasReducedMotion: !!window.matchMedia('(prefers-reduced-motion: reduce)').matches,
            fontSize: getComputedStyle(document.documentElement).fontSize
          };
        }),

        // Performance impact
        performance: await page.evaluate(() => {
          const perf = performance.getEntriesByType('navigation')[0];
          return {
            loadTime: perf ? Math.round(perf.loadEventEnd - perf.loadEventStart) : 0,
            domInteractive: perf ? Math.round(perf.domInteractive - perf.navigationStart) : 0,
            firstContentfulPaint: performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0
          };
        })
      };

      return enhancedData;
    } catch (error) {
      console.warn('⚠️  Failed to collect enhanced data:', error.message);
      return {};
    }
  }

  /**
   * Get enhanced analysis from SaaS platform
   */
  async getEnhancedAnalysis(scanResult) {
    if (!this.config.sessionToken || !this.config.apiUrl) {
      console.log('⚠️  Skipping enhanced analysis - no session token or API URL');
      return null;
    }

    try {
      console.log('🧠 Requesting enhanced analysis from SaaS...');
      
      // Prepare sanitized data for SaaS analysis (no sensitive content)
      const analysisPayload = {
        scanId: scanResult.scanId,
        url: scanResult.url,
        basicResults: {
          score: scanResult.score,
          summary: scanResult.summary,
          violationPatterns: scanResult.violations.map(v => ({
            id: v.id,
            impact: v.impact,
            tags: v.tags,
            nodeCount: v.nodeCount,
            // Don't send actual HTML content
            context: v.nodes?.[0]?.target || []
          }))
        },
        enhancedData: scanResult.enhancedData,
        metadata: {
          ...scanResult.metadata,
          source: 'github-actions-hybrid'
        }
      };

      const response = await fetch(`${this.config.apiUrl}/api/v1/analysis/enhance`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.sessionToken}`,
          'Content-Type': 'application/json',
          'X-Scanner-Mode': 'hybrid',
          'X-Analysis-Version': '1.0'
        },
        body: JSON.stringify(analysisPayload)
      });

      if (response.ok) {
        const enhancedAnalysis = await response.json();
        console.log('✅ Enhanced analysis received from SaaS');
        return enhancedAnalysis;
      } else {
        console.warn('⚠️  Enhanced analysis request failed:', response.status);
        return null;
      }
    } catch (error) {
      console.warn('⚠️  Error requesting enhanced analysis:', error.message);
      return null;
    }
  }

  async reportToSaas(results) {
    if (!this.config.sessionToken || !this.config.apiUrl) {
      console.log('⚠️  Skipping SaaS reporting - no session token or API URL');
      return;
    }

    try {
      console.log('📤 Reporting usage metrics to SaaS...');
      
      const response = await fetch(`${this.config.apiUrl}/api/v1/usage/track`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.sessionToken}`,
          'Content-Type': 'application/json',
          'X-Scanner-Mode': 'self-hosted'
        },
        body: JSON.stringify({
          scanId: results.scanId,
          url: results.url,
          summary: {
            score: results.enhancedAnalysis?.enhancedScore || results.score,
            violationCount: results.summary.violationCount,
            duration: results.duration
          },
          metadata: {
            ...results.metadata,
            source: 'github-actions',
            mode: 'hybrid',
            enhancedAnalysisUsed: !!results.enhancedAnalysis
          }
        })
      });

      if (response.ok) {
        const data = await response.json();
        console.log('✅ Usage reported to SaaS:', data);
      } else {
        console.warn('⚠️  Failed to report to SaaS:', response.status);
      }
    } catch (error) {
      console.warn('⚠️  Error reporting to SaaS:', error.message);
    }
  }

  async getBrowser(browserType = 'chromium') {
    if (!this.browsers[browserType]) {
      console.log(`🌐 Launching ${browserType} browser...`);
      
      const launchOptions = {
        headless: this.config.headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      };

      switch (browserType) {
        case 'firefox':
          this.browsers[browserType] = await firefox.launch(launchOptions);
          break;
        case 'webkit':
          this.browsers[browserType] = await webkit.launch(launchOptions);
          break;
        default:
          this.browsers[browserType] = await chromium.launch(launchOptions);
      }
    }
    
    return this.browsers[browserType];
  }

  async start() {
    const port = this.config.port;
    
    this.server = this.app.listen(port, () => {
      console.log(`🚀 Scanner service running on port ${port}`);
      console.log(`📊 Mode: ${this.config.mode}`);
      console.log(`🔍 WCAG Level: ${this.config.wcagLevel}`);
      console.log(`📤 Report to SaaS: ${this.config.reportToSaas}`);
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('Shutting down scanner service...');
      
      // Close browsers
      for (const browser of Object.values(this.browsers)) {
        await browser.close();
      }
      
      // Close server
      this.server.close(() => {
        console.log('Scanner service stopped');
        process.exit(0);
      });
    });
  }
}

// Start the service
const scanner = new ScannerService();
scanner.start().catch(error => {
  console.error('Failed to start scanner service:', error);
  process.exit(1);
});