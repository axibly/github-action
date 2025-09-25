# ADA Platform GitHub Action

🔍 **Automated accessibility testing for your web applications**

This GitHub Action integrates with the [ADA Platform](https://ada-platform.com) to automatically scan your web applications for accessibility violations during your CI/CD pipeline.

## ✨ Features

- 🚀 **Easy Integration**: Add accessibility scanning to any workflow in minutes
- 🏠 **Self-Hosted Scanner**: Runs locally within your GitHub Actions environment
- 🐳 **Docker-Based**: Lightweight, isolated scanning with Playwright + axe-core
- 📊 **WCAG Compliance**: Test against WCAG 2.1 Level A, AA, or AAA standards
- 📈 **Detailed Reports**: Generate JSON, HTML, and Markdown reports
- 💬 **PR Comments**: Automatic pull request comments with scan results
- 🎯 **Configurable Thresholds**: Set minimum accessibility scores for your team
- 📦 **Artifact Upload**: Save reports as GitHub artifacts for later review

## 🚀 Quick Start

1. **Get an ADA Platform API Key**
   - Sign up at [ADA Platform](https://ada-platform.com)
   - Generate an API key in your dashboard
   - Add it to your repository secrets as `ADA_API_KEY`

2. **Add the Action to Your Workflow**

```yaml
name: Accessibility Check

on:
  pull_request:
    branches: [ main ]

jobs:
  accessibility-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      # Build and start your application
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
      
      - run: npm ci && npm run build && npm start &
      - run: npx wait-on http://localhost:3000
      
      # Run accessibility scan
      # Automatically detects localhost and uses self-hosted mode
      - name: ADA Accessibility Scan
        uses: ada-platform/github-actions@v2
        with:
          server-url: 'http://localhost:3000'
          api-key: ${{ secrets.ADA_API_KEY }}
          wcag-level: 'AA'
          threshold: 80
```

## 🎯 How It Works

This GitHub Action runs accessibility scans using a **self-hosted scanner** optimized for CI/CD:

- 🐳 **Docker-based Scanner**: Spins up a lightweight container with Playwright + axe-core
- 🚀 **No External Dependencies**: All scanning happens locally within your GitHub Actions runner  
- 📊 **Account Management**: API key validates your account limits and features
- 📈 **Usage Tracking**: Optional reporting to ADA Platform for metrics and billing
- 🧹 **Automatic Cleanup**: Containers are properly cleaned up after scanning

Perfect for testing applications running on `localhost`, private networks, or any URL accessible from your CI environment!

## 📋 Configuration

### Required Inputs

| Input | Description | Example |
|-------|-------------|---------|
| `server-url` | Base URL of your running application | `http://localhost:3000` |
| `api-key` | ADA Platform API key | `${{ secrets.ADA_API_KEY }}` |

### Scanning Configuration

| Input | Description | Default | Options |
|-------|-------------|---------|---------|
| `scan-strategy` | Page discovery method | `single` | `single`, `sitemap`, `crawl`, `paths` |
| `scan-paths` | Custom paths to scan (newline separated) | - | `/\n/about\n/products` |
| `max-pages` | Maximum pages to scan | `10` | Any positive integer |
| `wcag-level` | WCAG compliance level | `AA` | `A`, `AA`, `AAA` |
| `threshold` | Minimum score to pass (0-100) | `80` | `0-100` |
| `fail-on-violations` | Fail the action if score below threshold | `true` | `true`, `false` |
| `include-best-practices` | Include accessibility best practices | `true` | `true`, `false` |
| `include-experimental` | Include experimental rules | `false` | `true`, `false` |

### Server Configuration

| Input | Description | Default |
|-------|-------------|---------|
| `health-check-path` | Path for server health check | `/` |
| `health-check-timeout` | Seconds to wait for server | `30` |

### Reporting Configuration

| Input | Description | Default |
|-------|-------------|---------|
| `report-formats` | Report formats to generate | `json,html` |
| `comment-pr` | Post results as PR comment | `true` |
| `upload-artifacts` | Upload reports as artifacts | `true` |
| `github-token` | GitHub token for PR comments | `${{ secrets.GITHUB_TOKEN }}` |

### Advanced Configuration

| Input | Description | Default |
|-------|-------------|---------|
| `api-url` | ADA Platform API URL | `https://api.ada-platform.com` |
| `custom-headers` | Custom HTTP headers (JSON) | `{}` |
| `user-agent` | Custom user agent string | `ADA-Platform-GitHub-Action/1.0` |

## 📊 Outputs

| Output | Description | Example |
|--------|-------------|---------|
| `scan-id` | Unique identifier for the scan | `abc123-def456-789` |
| `score` | Overall accessibility score (0-100) | `85` |
| `violations-count` | Number of violations found | `3` |
| `pages-scanned` | Number of pages scanned | `5` |
| `success` | Whether scan passed the threshold | `true` |
| `report-json` | Path to JSON report | `./ada-reports/report.json` |
| `report-html` | Path to HTML report | `./ada-reports/report.html` |
| `report-markdown` | Path to Markdown report | `./ada-reports/report.md` |

## 🔧 Scan Strategies

### Single Page (`single`)
Scans only the home page of your application.

```yaml
- uses: ada-platform/github-actions@v1
  with:
    server-url: 'http://localhost:3000'
    api-key: ${{ secrets.ADA_API_KEY }}
    scan-strategy: 'single'
```

### Sitemap Discovery (`sitemap`)
Automatically discovers pages from your sitemap.xml file.

```yaml
- uses: ada-platform/github-actions@v1
  with:
    server-url: 'http://localhost:3000'
    api-key: ${{ secrets.ADA_API_KEY }}
    scan-strategy: 'sitemap'
    max-pages: 25
```

### Web Crawling (`crawl`)
Crawls your website starting from the home page, following links.

```yaml
- uses: ada-platform/github-actions@v1
  with:
    server-url: 'http://localhost:3000'
    api-key: ${{ secrets.ADA_API_KEY }}
    scan-strategy: 'crawl'
    max-pages: 50
```

### Custom Paths (`paths`)
Scans specific paths you define.

```yaml
- uses: ada-platform/github-actions@v1
  with:
    server-url: 'http://localhost:3000'
    api-key: ${{ secrets.ADA_API_KEY }}
    scan-strategy: 'paths'
    scan-paths: |
      /
      /about
      /products
      /contact
      /dashboard
```

## 📈 Example Workflows

### Basic PR Check
```yaml
name: Accessibility Check

on:
  pull_request:

jobs:
  accessibility:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      
      - run: npm ci && npm run build
      - run: npm start &
      - run: npx wait-on http://localhost:3000
      
      - uses: ada-platform/github-actions@v1
        with:
          server-url: 'http://localhost:3000'
          api-key: ${{ secrets.ADA_API_KEY }}
          threshold: 85
          comment-pr: true
```

### Comprehensive Scan with Multiple Formats
```yaml
name: Comprehensive Accessibility

on:
  push:
    branches: [ main ]

jobs:
  accessibility:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      # Your build steps here
      
      - uses: ada-platform/github-actions@v1
        with:
          server-url: 'http://localhost:3000'
          api-key: ${{ secrets.ADA_API_KEY }}
          scan-strategy: 'crawl'
          max-pages: 30
          wcag-level: 'AAA'
          threshold: 75
          include-best-practices: true
          report-formats: 'json,html,markdown'
          upload-artifacts: true
```

### Multi-Environment Testing
```yaml
name: Multi-Environment Accessibility

on:
  schedule:
    - cron: '0 2 * * 1'  # Weekly

jobs:
  accessibility:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        env:
          - { name: 'staging', url: 'https://staging.example.com' }
          - { name: 'production', url: 'https://example.com' }
    
    steps:
      - uses: ada-platform/github-actions@v1
        with:
          server-url: ${{ matrix.env.url }}
          api-key: ${{ secrets.ADA_API_KEY }}
          scan-strategy: 'sitemap'
          max-pages: 50
          wcag-level: 'AA'
          threshold: 85
          fail-on-violations: false  # Just report, don't fail
```

## 🔒 Authentication & Headers

For applications requiring authentication, you can provide custom headers:

```yaml
- uses: ada-platform/github-actions@v1
  with:
    server-url: 'http://localhost:3000'
    api-key: ${{ secrets.ADA_API_KEY }}
    custom-headers: |
      {
        "Authorization": "Bearer ${{ secrets.TEST_TOKEN }}",
        "X-API-Key": "${{ secrets.API_KEY }}"
      }
```

## 📊 Reading Results

### In Your Workflow
```yaml
- uses: ada-platform/github-actions@v1
  id: accessibility-scan
  with:
    server-url: 'http://localhost:3000'
    api-key: ${{ secrets.ADA_API_KEY }}

- name: Check Results
  run: |
    echo "Scan ID: ${{ steps.accessibility-scan.outputs.scan-id }}"
    echo "Score: ${{ steps.accessibility-scan.outputs.score }}/100"
    echo "Violations: ${{ steps.accessibility-scan.outputs.violations-count }}"
    echo "Success: ${{ steps.accessibility-scan.outputs.success }}"
```

### PR Comments
When `comment-pr: true`, the action automatically posts a comment with results:

> ## ✅ ADA Accessibility Scan Results
> 
> **Overall Score:** 87/100 (PASSED)
> 
> ### 📊 Summary
> - **Pages Scanned:** 8
> - **Total Violations:** 5
> - **Tests Passed:** 127
> 
> ### 📄 Page Results
> ✅ `/` - 92/100 (2 violations)
> ✅ `/about` - 88/100 (1 violations)
> ⚠️ `/contact` - 79/100 (2 violations)
> 
> *🤖 Generated by [ADA Platform](https://ada-platform.com) • Scan ID: `abc123-def456`*

## 🐛 Troubleshooting

### Common Issues

**Server not ready**
```
Error: Server health check failed after 30s
```
- Increase `health-check-timeout`
- Ensure your server starts before the scan
- Check the `health-check-path` is correct

**No pages found**
```
Error: No pages discovered for scanning
```
- Verify `server-url` is accessible
- Check sitemap.xml exists (for sitemap strategy)
- Provide explicit `scan-paths` (for paths strategy)

**API authentication failed**
```
Error: Failed to submit scan job: 401 Unauthorized
```
- Verify your `api-key` is correct
- Check the secret name matches (`ADA_API_KEY`)
- Ensure your ADA Platform account is active

### Debug Mode

Enable debug logging by setting the `ACTIONS_RUNNER_DEBUG` secret to `true` in your repository.

## 📚 Resources

- [ADA Platform Documentation](https://docs.ada-platform.com)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)

## 🤝 Support

- 📧 Email: support@ada-platform.com
- 💬 Chat: Available in your ADA Platform dashboard
- 📖 Docs: [docs.ada-platform.com](https://docs.ada-platform.com)
- 🐛 Issues: [GitHub Issues](https://github.com/ada-platform/github-actions/issues)

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

Made with ❤️ by the [ADA Platform](https://ada-platform.com) team