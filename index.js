const core = require('@actions/core');
const github = require('@actions/github');
const exec = require('@actions/exec');
const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');

const PageDiscovery = require('./src/page-discovery');

/**
 * Main GitHub Action entry point for ADA Accessibility Scanner
 * Scans provided server URL for accessibility violations
 */
class AdaAccessibilityAction {
  constructor() {
    this.inputs = this.getInputs();
    this.pageDiscovery = new PageDiscovery({
      maxPages: parseInt(this.inputs.maxPages),
      timeout: 10000
    });
    
    this.scanId = require('uuid').v4();
    this.startTime = Date.now();
    this.mode = null; // Will be determined automatically
    this.sessionToken = null;
    this.accountConfig = null;
    
    console.log(`🚀 Starting ADA Accessibility Scanner: ${this.scanId}`);
  }

  /**
   * Get and validate action inputs
   */
  getInputs() {
    const inputs = {
      // Required
      serverUrl: core.getInput('server-url', { required: true }),
      apiKey: core.getInput('api-key', { required: true }),
      
      // Server configuration
      healthCheckPath: core.getInput('health-check-path') || '/',
      healthCheckTimeout: parseInt(core.getInput('health-check-timeout')) || 30,
      
      // Scanning configuration
      scanStrategy: core.getInput('scan-strategy') || 'single',
      scanPaths: core.getInput('scan-paths') || '',
      maxPages: core.getInput('max-pages') || '10',
      
      // Accessibility configuration
      wcagLevel: core.getInput('wcag-level') || 'AA',
      failOnViolations: core.getInput('fail-on-violations') === 'true',
      threshold: parseInt(core.getInput('threshold')) || 80,
      includeBestPractices: core.getInput('include-best-practices') === 'true',
      includeExperimental: core.getInput('include-experimental') === 'true',
      
      // ADA Platform integration
      apiUrl: core.getInput('api-url') || 'https://api.axibly.com',
      
      // Reporting
      reportFormats: (core.getInput('report-formats') || 'json,html').split(','),
      commentPr: core.getInput('comment-pr') === 'true',
      uploadArtifacts: core.getInput('upload-artifacts') === 'true',
      
      // Advanced
      customHeaders: this.parseJsonInput('custom-headers') || {},
      userAgent: core.getInput('user-agent') || 'ADA-Platform-GitHub-Action/1.0'
    };

    // Validate server URL
    try {
      new URL(inputs.serverUrl);
    } catch (error) {
      throw new Error(`Invalid server-url: ${inputs.serverUrl}`);
    }

    return inputs;
  }

  /**
   * Parse JSON input safely
   */
  parseJsonInput(inputName) {
    const value = core.getInput(inputName);
    if (!value) return null;
    
    try {
      return JSON.parse(value);
    } catch (error) {
      console.warn(`⚠️  Failed to parse ${inputName} as JSON: ${value}`);
      return null;
    }
  }

  /**
   * Main action execution
   */
  async run() {
    try {
      // Step 1: Validate API key and get account configuration
      console.log(`🔑 Validating API key and fetching account configuration`);
      await this.validateApiKeyAndAccount();

      // Step 2: Use self-hosted mode (optimal for CI/CD environments)
      this.mode = 'self-hosted';
      console.log(`🏠 Using self-hosted scanner for CI/CD environment`);

      // Step 3: Setup self-hosted scanner
      await this.setupSelfHostedScanner();

      // Step 4: Health check the server
      console.log(`🩺 Health checking server: ${this.inputs.serverUrl}`);
      await this.healthCheckServer();

      // Step 5: Discover pages to scan
      console.log(`🔍 Discovering pages using strategy: ${this.inputs.scanStrategy}`);
      const pagesToScan = await this.discoverPages();

      // Step 6: Execute scans
      console.log(`🔬 Starting accessibility scans for ${pagesToScan.length} pages`);
      const scanResults = await this.executeScans(pagesToScan);

      // Step 7: Process and aggregate results
      console.log(`📊 Processing scan results`);
      const aggregatedResults = this.aggregateResults(scanResults);

      // Step 8: Generate reports
      console.log(`📝 Generating reports`);
      const reportPaths = await this.generateReports(aggregatedResults, scanResults);

      // Step 9: Set outputs
      this.setOutputs(aggregatedResults, reportPaths);

      // Step 10: Handle PR comments
      if (this.inputs.commentPr && github.context.eventName === 'pull_request') {
        await this.commentOnPullRequest(aggregatedResults);
      }

      // Step 11: Upload artifacts
      if (this.inputs.uploadArtifacts) {
        await this.uploadArtifacts(reportPaths);
      }

      // Step 12: Report usage to SaaS (if configured)
      if (this.sessionToken) {
        await this.reportUsageToSaaS(aggregatedResults);
      }

      // Step 13: Determine success/failure
      const success = this.evaluateSuccess(aggregatedResults);
      
      const duration = Date.now() - this.startTime;
      console.log(`✅ ADA Accessibility Scanner completed in ${duration}ms`);
      console.log(`📈 Overall Score: ${aggregatedResults.score}/100`);
      console.log(`🚨 Violations Found: ${aggregatedResults.totalViolations}`);

      if (!success && this.inputs.failOnViolations) {
        core.setFailed(`Accessibility scan failed: Score ${aggregatedResults.score} below threshold ${this.inputs.threshold}`);
      }

    } catch (error) {
      console.error('❌ ADA Accessibility Scanner failed:', error);
      core.setFailed(error.message);
    } finally {
      // Cleanup self-hosted scanner
      await this.cleanupSelfHostedScanner();
    }
  }

  /**
   * Health check the provided server
   */
  async healthCheckServer() {
    const healthUrl = `${this.inputs.serverUrl}${this.inputs.healthCheckPath}`;
    const startTime = Date.now();
    const timeout = this.inputs.healthCheckTimeout * 1000;

    while (Date.now() - startTime < timeout) {
      try {
        const response = await fetch(healthUrl, {
          timeout: 5000,
          headers: {
            'User-Agent': this.inputs.userAgent,
            ...this.inputs.customHeaders
          }
        });

        if (response.ok || response.status === 404) {
          // 404 is acceptable - server is responding
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          console.log(`✅ Server health check passed (${response.status}) after ${elapsed}s`);
          return;
        } else {
          console.log(`🔄 Server returned ${response.status}, retrying...`);
        }
      } catch (error) {
        if (error.code === 'ECONNREFUSED') {
          console.log('🔄 Server not ready yet, retrying...');
        } else {
          console.log(`🔄 Health check error: ${error.message}, retrying...`);
        }
      }

      // Wait before next attempt
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    throw new Error(`Server health check failed after ${this.inputs.healthCheckTimeout}s at ${healthUrl}`);
  }

  /**
   * Discover pages to scan using the configured strategy
   */
  async discoverPages() {
    const options = {
      maxPages: parseInt(this.inputs.maxPages),
      paths: this.inputs.scanPaths ? this.inputs.scanPaths.split('\n').map(p => p.trim()).filter(p => p) : []
    };

    const pages = await this.pageDiscovery.discoverPages(
      this.inputs.serverUrl,
      this.inputs.scanStrategy,
      options
    );

    if (pages.length === 0) {
      throw new Error('No pages discovered for scanning');
    }

    return pages;
  }

  /**
   * Validate API key and get account configuration
   */
  async validateApiKeyAndAccount() {
    try {
      const response = await fetch(`${this.inputs.apiUrl}/api/v1/validate-key`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          apiKey: this.inputs.apiKey,
          metadata: {
            source: 'github-actions',
            repository: github.context.repo.repo,
            actor: github.context.actor,
            workflow: github.context.workflow
          }
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API key validation failed: ${error}`);
      }

      const data = await response.json();
      this.sessionToken = data.sessionToken;
      this.accountConfig = data.account;

      // Apply account limits
      if (this.accountConfig.limits.maxPagesPerScan > 0 && 
          this.inputs.maxPages > this.accountConfig.limits.maxPagesPerScan) {
        console.warn(`⚠️  Reducing max pages from ${this.inputs.maxPages} to account limit ${this.accountConfig.limits.maxPagesPerScan}`);
        this.inputs.maxPages = this.accountConfig.limits.maxPagesPerScan;
      }

      console.log(`✅ API key validated. Account tier: ${this.accountConfig.tier}`);
    } catch (error) {
      console.warn(`⚠️  API key validation failed: ${error.message}`);
      console.warn(`   Running in offline mode with default limits`);
      
      // Set default limits for offline mode
      this.accountConfig = {
        tier: 'offline',
        limits: {
          maxPagesPerScan: 5,
          monthlyScans: 100
        },
        features: {
          selfHosted: true,
          advancedReporting: false
        }
      };
    }
  }


  /**
   * Setup self-hosted scanner using Docker
   */
  async setupSelfHostedScanner() {
    console.log('🐳 Starting self-hosted scanner stack...');
    
    try {
      // Check if docker-compose file exists
      const composeFile = path.join(__dirname, 'docker-compose.ci.yml');
      
      // Set environment variables for docker-compose
      const env = {
        SESSION_TOKEN: this.sessionToken || '',
        ACCOUNT_CONFIG: JSON.stringify(this.accountConfig || {}),
        MAX_PAGES: this.inputs.maxPages.toString(),
        WCAG_LEVEL: this.inputs.wcagLevel,
        INCLUDE_BEST_PRACTICES: this.inputs.includeBestPractices.toString(),
        INCLUDE_EXPERIMENTAL: this.inputs.includeExperimental.toString(),
        API_URL: this.inputs.apiUrl,
        REPORT_TO_SAAS: (!!this.sessionToken).toString()
      };

      // Start docker-compose
      await exec.exec('docker-compose', [
        '-f', composeFile,
        'up', '-d'
      ], {
        env: { ...process.env, ...env }
      });

      // Wait for scanner service to be ready
      console.log('⏳ Waiting for scanner service to be ready...');
      const scannerUrl = 'http://localhost:3003';
      const maxAttempts = 30;
      
      for (let i = 0; i < maxAttempts; i++) {
        try {
          const response = await fetch(`${scannerUrl}/health`);
          if (response.ok) {
            console.log('✅ Scanner service is ready');
            this.scannerUrl = scannerUrl;
            return;
          }
        } catch (error) {
          // Service not ready yet
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      throw new Error('Scanner service failed to start within timeout');
    } catch (error) {
      console.error('Failed to setup self-hosted scanner:', error);
      throw error;
    }
  }

  /**
   * Cleanup self-hosted scanner
   */
  async cleanupSelfHostedScanner() {
    console.log('🧹 Cleaning up self-hosted scanner...');
    
    try {
      const composeFile = path.join(__dirname, 'docker-compose.ci.yml');
      
      // Stop and remove containers
      await exec.exec('docker-compose', [
        '-f', composeFile,
        'down', '-v'
      ]);
      
      console.log('✅ Self-hosted scanner cleaned up');
    } catch (error) {
      console.warn('⚠️  Failed to cleanup scanner:', error.message);
    }
  }

  /**
   * Execute accessibility scans using self-hosted scanner
   */
  async executeScans(pages) {
    const results = [];
    
    for (const page of pages) {
      const fullUrl = page.startsWith('http') ? page : `${this.inputs.serverUrl}${page}`;
      
      console.log(`📡 Scanning with self-hosted scanner: ${fullUrl}`);
      
      try {
        const response = await fetch(`${this.scannerUrl}/scan-sync`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            url: fullUrl,
            options: {
              wcagLevel: this.inputs.wcagLevel,
              includeBestPractices: this.inputs.includeBestPractices,
              includeExperimental: this.inputs.includeExperimental,
              customHeaders: this.inputs.customHeaders,
              userAgent: this.inputs.userAgent
            }
          })
        });

        if (!response.ok) {
          throw new Error(`Scanner returned ${response.status}`);
        }

        const result = await response.json();
        results.push(result);
        
        console.log(`✅ Scan completed: ${fullUrl} - Score: ${result.summary?.score || 0}`);
      } catch (error) {
        console.error(`❌ Failed to scan ${fullUrl}:`, error);
        results.push({
          url: fullUrl,
          status: 'failed',
          error: error.message,
          summary: { score: 0, violationCount: 0, passCount: 0 }
        });
      }
    }
    
    return results;
  }



  /**
   * Aggregate results from multiple scans with enhanced analysis
   */
  aggregateResults(scanResults) {
    const totalScans = scanResults.length;
    const completedScans = scanResults.filter(r => r.status === 'completed');
    const failedScans = scanResults.filter(r => r.status === 'failed');

    const totalViolations = completedScans.reduce((sum, r) => sum + r.summary.violationCount, 0);
    const totalPasses = completedScans.reduce((sum, r) => sum + r.summary.passCount, 0);
    
    // Calculate weighted average score (use enhanced score if available)
    const totalScore = completedScans.reduce((sum, r) => {
      return sum + (r.enhancedAnalysis?.enhancedScore || r.summary.score);
    }, 0);
    const averageScore = completedScans.length > 0 ? Math.round(totalScore / completedScans.length) : 0;

    // Enhanced score if available
    const hasEnhancedAnalysis = completedScans.some(r => r.enhancedAnalysis);
    
    // Group violations by severity
    const violationsBySeverity = {
      critical: 0,
      serious: 0,
      moderate: 0,
      minor: 0
    };

    completedScans.forEach(scan => {
      scan.violations.forEach(violation => {
        if (violationsBySeverity[violation.impact] !== undefined) {
          violationsBySeverity[violation.impact] += violation.nodeCount || violation.nodes?.length || 1;
        }
      });
    });

    // Aggregate business impact if available
    const businessImpact = this.aggregateBusinessImpact(completedScans);
    
    // Aggregate remediation recommendations
    const remediationPlan = this.aggregateRemediationPlan(completedScans);

    return {
      scanId: this.scanId,
      totalScans,
      completedScans: completedScans.length,
      failedScans: failedScans.length,
      score: averageScore,
      totalViolations,
      totalPasses,
      violationsBySeverity,
      hasEnhancedAnalysis,
      businessImpact,
      remediationPlan,
      pageResults: scanResults.map(r => ({
        url: r.url,
        status: r.status,
        score: r.enhancedAnalysis?.enhancedScore || r.summary?.score || 0,
        basicScore: r.summary?.score || 0,
        violations: r.summary?.violationCount || 0,
        enhancedAnalysis: r.enhancedAnalysis ? {
          riskLevel: r.enhancedAnalysis.businessImpact?.riskLevel,
          userImpactPercentage: r.enhancedAnalysis.businessImpact?.userImpactPercentage,
          priority1Fixes: r.enhancedAnalysis.remediationPlan?.priority1?.length || 0
        } : null
      }))
    };
  }

  /**
   * Aggregate business impact across all scans
   */
  aggregateBusinessImpact(completedScans) {
    const scansWithAnalysis = completedScans.filter(scan => scan.enhancedAnalysis);
    
    if (scansWithAnalysis.length === 0) return null;
    
    const riskLevels = scansWithAnalysis.map(scan => scan.enhancedAnalysis.businessImpact?.riskLevel);
    const highestRisk = riskLevels.includes('high') ? 'high' : 
                       riskLevels.includes('medium') ? 'medium' : 'low';
    
    const totalEstimatedCost = scansWithAnalysis.reduce((sum, scan) => {
      const cost = scan.enhancedAnalysis.businessImpact?.estimatedRemediationCost;
      return sum + (cost?.max || 0);
    }, 0);
    
    return {
      overallRisk: highestRisk,
      pagesAtRisk: scansWithAnalysis.filter(scan => 
        scan.enhancedAnalysis.businessImpact?.riskLevel === 'high'
      ).length,
      estimatedRemediationCost: Math.round(totalEstimatedCost),
      topBusinessAreas: this.getTopBusinessAreas(scansWithAnalysis)
    };
  }

  /**
   * Aggregate remediation plan across all scans
   */
  aggregateRemediationPlan(completedScans) {
    const scansWithAnalysis = completedScans.filter(scan => scan.enhancedAnalysis);
    
    if (scansWithAnalysis.length === 0) return null;
    
    const aggregatedPlan = {
      totalQuickFixes: 0,
      totalMediumFixes: 0,
      totalComplexFixes: 0,
      topPriority1Issues: [],
      estimatedTotalHours: 0
    };
    
    scansWithAnalysis.forEach(scan => {
      const effort = scan.enhancedAnalysis.remediationPlan?.estimatedEffort;
      if (effort) {
        aggregatedPlan.totalQuickFixes += effort.quickFixes || 0;
        aggregatedPlan.totalMediumFixes += effort.mediumFixes || 0;
        aggregatedPlan.totalComplexFixes += effort.complexFixes || 0;
      }
      
      // Collect priority 1 issues
      const priority1 = scan.enhancedAnalysis.remediationPlan?.priority1 || [];
      aggregatedPlan.topPriority1Issues.push(...priority1);
    });
    
    // Calculate estimated hours
    aggregatedPlan.estimatedTotalHours = Math.round(
      aggregatedPlan.totalQuickFixes * 0.5 +
      aggregatedPlan.totalMediumFixes * 4 +
      aggregatedPlan.totalComplexFixes * 16
    );
    
    // Deduplicate and prioritize issues
    aggregatedPlan.topPriority1Issues = this.deduplicateIssues(aggregatedPlan.topPriority1Issues);
    
    return aggregatedPlan;
  }

  /**
   * Helper method to get top business areas affected
   */
  getTopBusinessAreas(scansWithAnalysis) {
    const areaCount = {};
    
    scansWithAnalysis.forEach(scan => {
      const areas = scan.enhancedAnalysis.businessImpact?.businessAreas || [];
      areas.forEach(area => {
        areaCount[area] = (areaCount[area] || 0) + 1;
      });
    });
    
    return Object.entries(areaCount)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([area, count]) => ({ area, affectedPages: count }));
  }

  /**
   * Helper method to deduplicate remediation issues
   */
  deduplicateIssues(issues) {
    const unique = [];
    const seen = new Set();
    
    issues.forEach(issue => {
      const key = issue.title + issue.description;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(issue);
      }
    });
    
    return unique.slice(0, 5); // Return top 5 priority issues
  }

  /**
   * Generate scan reports in specified formats
   */
  async generateReports(aggregatedResults, scanResults) {
    const reportDir = './ada-reports';
    await fs.mkdir(reportDir, { recursive: true });
    
    const reportPaths = {};

    // Generate JSON report
    if (this.inputs.reportFormats.includes('json')) {
      const jsonPath = path.join(reportDir, 'accessibility-report.json');
      const jsonReport = {
        metadata: {
          scanId: this.scanId,
          timestamp: new Date().toISOString(),
          repository: github.context.repo.repo,
          commit: github.context.sha,
          branch: github.context.ref.replace('refs/heads/', ''),
          actor: github.context.actor
        },
        summary: aggregatedResults,
        scans: scanResults
      };
      
      await fs.writeFile(jsonPath, JSON.stringify(jsonReport, null, 2));
      reportPaths.json = jsonPath;
      console.log(`📄 JSON report generated: ${jsonPath}`);
    }

    // Generate HTML report
    if (this.inputs.reportFormats.includes('html')) {
      const htmlPath = path.join(reportDir, 'accessibility-report.html');
      const htmlContent = this.generateHtmlReport(aggregatedResults, scanResults);
      await fs.writeFile(htmlPath, htmlContent);
      reportPaths.html = htmlPath;
      console.log(`📄 HTML report generated: ${htmlPath}`);
    }

    // Generate Markdown report
    if (this.inputs.reportFormats.includes('markdown')) {
      const mdPath = path.join(reportDir, 'accessibility-report.md');
      const mdContent = this.generateMarkdownReport(aggregatedResults, scanResults);
      await fs.writeFile(mdPath, mdContent);
      reportPaths.markdown = mdPath;
      console.log(`📄 Markdown report generated: ${mdPath}`);
    }

    return reportPaths;
  }

  /**
   * Generate HTML report content
   */
  generateHtmlReport(summary, scans) {
    const passedScans = scans.filter(s => s.status === 'completed' && s.summary.score >= this.inputs.threshold);
    const failedScans = scans.filter(s => s.status === 'failed' || (s.summary?.score || 0) < this.inputs.threshold);
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ADA Accessibility Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 8px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { border-bottom: 2px solid #eee; padding-bottom: 20px; margin-bottom: 30px; }
        .score { font-size: 3rem; font-weight: bold; color: ${summary.score >= this.inputs.threshold ? '#28a745' : '#dc3545'}; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 30px 0; }
        .metric { background: #f8f9fa; padding: 20px; border-radius: 6px; text-align: center; }
        .metric-value { font-size: 2rem; font-weight: bold; margin-bottom: 5px; }
        .metric-label { color: #6c757d; font-size: 0.9rem; }
        .violations { background: #dc3545; color: white; } .passes { background: #28a745; color: white; }
        .pages { margin-top: 40px; } .page { margin: 20px 0; padding: 20px; border: 1px solid #ddd; border-radius: 6px; }
        .page-url { font-weight: bold; margin-bottom: 10px; } .page-score { float: right; padding: 5px 10px; border-radius: 20px; color: white; }
        .score-good { background: #28a745; } .score-poor { background: #dc3545; } .score-fair { background: #ffc107; color: black; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔍 ADA Accessibility Report</h1>
            <p>Scan ID: ${summary.scanId} | Generated: ${new Date().toLocaleString()}</p>
            <div class="score">${summary.score}/100</div>
        </div>
        
        <div class="summary">
            <div class="metric">
                <div class="metric-value">${summary.totalScans}</div>
                <div class="metric-label">Pages Scanned</div>
            </div>
            <div class="metric violations">
                <div class="metric-value">${summary.totalViolations}</div>
                <div class="metric-label">Total Violations</div>
            </div>
            <div class="metric passes">
                <div class="metric-value">${summary.totalPasses}</div>
                <div class="metric-label">Tests Passed</div>
            </div>
            <div class="metric">
                <div class="metric-value">${summary.completedScans}</div>
                <div class="metric-label">Successful Scans</div>
            </div>
        </div>

        <div class="pages">
            <h2>📄 Page Results</h2>
            ${summary.pageResults.map(page => `
                <div class="page">
                    <div class="page-url">${page.url}</div>
                    <span class="page-score ${page.score >= 80 ? 'score-good' : page.score >= 60 ? 'score-fair' : 'score-poor'}">
                        ${page.score}/100
                    </span>
                    <p>Status: ${page.status} | Violations: ${page.violations}</p>
                </div>
            `).join('')}
        </div>
    </div>
</body>
</html>`;
  }

  /**
   * Generate Markdown report content
   */
  generateMarkdownReport(summary, scans) {
    const statusEmoji = summary.score >= this.inputs.threshold ? '✅' : '❌';
    
    return `# ${statusEmoji} ADA Accessibility Report

**Overall Score:** ${summary.score}/100  
**Scan ID:** ${summary.scanId}  
**Generated:** ${new Date().toLocaleString()}

## 📊 Summary

| Metric | Value |
|--------|-------|
| Pages Scanned | ${summary.totalScans} |
| Successful Scans | ${summary.completedScans} |
| Failed Scans | ${summary.failedScans} |
| Total Violations | ${summary.totalViolations} |
| Tests Passed | ${summary.totalPasses} |

## 🚨 Violations by Severity

| Severity | Count |
|----------|-------|
| Critical | ${summary.violationsBySeverity.critical} |
| Serious | ${summary.violationsBySeverity.serious} |
| Moderate | ${summary.violationsBySeverity.moderate} |
| Minor | ${summary.violationsBySeverity.minor} |

## 📄 Page Results

${summary.pageResults.map(page => {
  const emoji = page.score >= 80 ? '✅' : page.score >= 60 ? '⚠️' : '❌';
  return `### ${emoji} ${page.url}

- **Score:** ${page.score}/100
- **Status:** ${page.status}
- **Violations:** ${page.violations}`;
}).join('\n\n')}

---
*Generated by [ADA Platform](https://ada-platform.com) GitHub Action*
`;
  }

  /**
   * Set GitHub Actions outputs
   */
  setOutputs(summary, reportPaths) {
    core.setOutput('scan-id', summary.scanId);
    core.setOutput('score', summary.score.toString());
    core.setOutput('violations-count', summary.totalViolations.toString());
    core.setOutput('pages-scanned', summary.totalScans.toString());
    core.setOutput('success', (summary.score >= this.inputs.threshold).toString());
    
    if (reportPaths.json) core.setOutput('report-json', reportPaths.json);
    if (reportPaths.html) core.setOutput('report-html', reportPaths.html);
    if (reportPaths.markdown) core.setOutput('report-markdown', reportPaths.markdown);
  }

  /**
   * Comment on pull request with results
   */
  async commentOnPullRequest(summary) {
    try {
      const token = core.getInput('github-token') || process.env.GITHUB_TOKEN;
      if (!token) {
        console.log('⚠️  No GitHub token provided, skipping PR comment');
        return;
      }

      const octokit = github.getOctokit(token);
      const statusEmoji = summary.score >= this.inputs.threshold ? '✅' : '❌';
      
      let comment = `## ${statusEmoji} ADA Accessibility Scan Results

**Overall Score:** ${summary.score}/100 ${summary.score >= this.inputs.threshold ? '(PASSED)' : '(FAILED)'}${summary.hasEnhancedAnalysis ? ' ✨ *Enhanced by AI*' : ''}

### 📊 Summary
- **Pages Scanned:** ${summary.totalScans}
- **Total Violations:** ${summary.totalViolations}
- **Tests Passed:** ${summary.totalPasses}`;

      // Add business impact if available
      if (summary.businessImpact) {
        const riskEmoji = summary.businessImpact.overallRisk === 'high' ? '🚨' : 
                          summary.businessImpact.overallRisk === 'medium' ? '⚠️' : '✅';
        comment += `
- **Business Risk:** ${riskEmoji} ${summary.businessImpact.overallRisk.toUpperCase()}
- **Estimated Fix Cost:** $${summary.businessImpact.estimatedRemediationCost.toLocaleString()}`;
      }

      // Add remediation plan if available  
      if (summary.remediationPlan) {
        comment += `

### 🔧 Remediation Plan
- **Quick Fixes:** ${summary.remediationPlan.totalQuickFixes} (~${Math.round(summary.remediationPlan.totalQuickFixes * 0.5)}h)
- **Medium Fixes:** ${summary.remediationPlan.totalMediumFixes} (~${summary.remediationPlan.totalMediumFixes * 4}h) 
- **Complex Fixes:** ${summary.remediationPlan.totalComplexFixes} (~${summary.remediationPlan.totalComplexFixes * 16}h)
- **Total Estimated:** ${summary.remediationPlan.estimatedTotalHours} hours`;
      }

      comment += `

### 📄 Page Results
${summary.pageResults.slice(0, 5).map(page => {
  const emoji = page.score >= 80 ? '✅' : page.score >= 60 ? '⚠️' : '❌';
  let line = `${emoji} \`${page.url}\` - ${page.score}/100 (${page.violations} violations)`;
  
  // Add enhanced analysis details if available
  if (page.enhancedAnalysis) {
    const riskEmoji = page.enhancedAnalysis.riskLevel === 'high' ? '🚨' : 
                      page.enhancedAnalysis.riskLevel === 'medium' ? '⚠️' : '✅';
    line += ` ${riskEmoji}`;
    
    if (page.enhancedAnalysis.priority1Fixes > 0) {
      line += ` • ${page.enhancedAnalysis.priority1Fixes} priority fixes`;
    }
    
    if (page.enhancedAnalysis.userImpactPercentage > 0) {
      line += ` • ${page.enhancedAnalysis.userImpactPercentage}% user impact`;
    }
  }
  
  return line;
}).join('\n')}

${summary.pageResults.length > 5 ? `\n*... and ${summary.pageResults.length - 5} more pages*` : ''}`;

      // Add top priority fixes if available
      if (summary.remediationPlan?.topPriority1Issues?.length > 0) {
        comment += `

### 🚨 Top Priority Fixes
${summary.remediationPlan.topPriority1Issues.slice(0, 3).map(issue => 
  `- **${issue.title}**: ${issue.description}`
).join('\n')}`;
      }

      comment += `

---
*🤖 Generated by [ADA Platform](https://ada-platform.com)${summary.hasEnhancedAnalysis ? ' with AI Enhancement' : ''} • Scan ID: \`${summary.scanId}\`*`;

      await octokit.rest.issues.createComment({
        ...github.context.repo,
        issue_number: github.context.payload.pull_request.number,
        body: comment
      });

      console.log('✅ PR comment posted successfully');
    } catch (error) {
      console.warn('⚠️  Failed to post PR comment:', error.message);
    }
  }

  /**
   * Upload reports as GitHub artifacts
   */
  async uploadArtifacts(reportPaths) {
    try {
      const artifact = require('@actions/artifact');
      const artifactClient = artifact.create();
      
      const files = Object.values(reportPaths).filter(Boolean);
      if (files.length === 0) return;

      const rootDirectory = './ada-reports';
      const artifactName = `accessibility-reports-${this.scanId.substring(0, 8)}`;
      
      const uploadResult = await artifactClient.uploadArtifact(
        artifactName,
        files,
        rootDirectory,
        { continueOnError: false }
      );

      console.log(`✅ Artifacts uploaded: ${uploadResult.artifactName}`);
    } catch (error) {
      console.warn('⚠️  Failed to upload artifacts:', error.message);
    }
  }

  /**
   * Report usage to SaaS platform
   */
  async reportUsageToSaaS(summary) {
    if (!this.sessionToken) return;
    
    try {
      console.log('📤 Reporting usage to SaaS platform...');
      
      await fetch(`${this.inputs.apiUrl}/api/v1/usage/track`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.sessionToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          mode: this.mode,
          scanId: this.scanId,
          summary: {
            totalScans: summary.totalScans,
            score: summary.score,
            violationCount: summary.totalViolations,
            duration: Date.now() - this.startTime
          },
          metadata: {
            repository: github.context.repo.repo,
            commit: github.context.sha,
            workflow: github.context.workflow,
            actor: github.context.actor
          }
        })
      });
      
      console.log('✅ Usage reported to SaaS platform');
    } catch (error) {
      console.warn('⚠️  Failed to report usage:', error.message);
    }
  }

  /**
   * Evaluate overall success based on threshold
   */
  evaluateSuccess(summary) {
    return summary.score >= this.inputs.threshold;
  }
}

// Execute the action
if (require.main === module) {
  const action = new AdaAccessibilityAction();
  action.run().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = AdaAccessibilityAction;