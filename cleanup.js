const core = require('@actions/core');
const fs = require('fs').promises;
const path = require('path');

/**
 * Cleanup script for ADA Accessibility Scanner GitHub Action
 * Runs after the main action completes to clean up temporary resources
 */
class AdaCleanupAction {
  constructor() {
    this.startTime = Date.now();
    console.log('🧹 Starting ADA Accessibility Scanner cleanup...');
  }

  /**
   * Main cleanup execution
   */
  async run() {
    try {
      // Clean up temporary files and directories
      await this.cleanupTempFiles();
      
      // Log cleanup completion
      const duration = Date.now() - this.startTime;
      console.log(`✅ Cleanup completed in ${duration}ms`);
      
    } catch (error) {
      console.warn('⚠️  Cleanup encountered errors (non-fatal):', error.message);
      // Don't fail the action due to cleanup issues
    }
  }

  /**
   * Clean up temporary files and directories
   */
  async cleanupTempFiles() {
    const tempPaths = [
      './ada-temp',
      './node_modules/.cache/ada-scanner',
      './tmp/ada-*'
    ];

    for (const tempPath of tempPaths) {
      try {
        await this.removeIfExists(tempPath);
      } catch (error) {
        console.warn(`⚠️  Could not clean up ${tempPath}: ${error.message}`);
      }
    }

    // Clean up any stale lock files
    const lockFiles = [
      './ada-scanner.lock',
      './scan-in-progress.lock'
    ];

    for (const lockFile of lockFiles) {
      try {
        await fs.unlink(lockFile);
        console.log(`🗑️  Removed lock file: ${lockFile}`);
      } catch (error) {
        // Lock file probably doesn't exist, which is fine
        if (error.code !== 'ENOENT') {
          console.warn(`⚠️  Could not remove lock file ${lockFile}: ${error.message}`);
        }
      }
    }
  }

  /**
   * Remove file or directory if it exists
   */
  async removeIfExists(targetPath) {
    try {
      const stat = await fs.stat(targetPath);
      
      if (stat.isDirectory()) {
        await fs.rmdir(targetPath, { recursive: true });
        console.log(`🗑️  Removed directory: ${targetPath}`);
      } else {
        await fs.unlink(targetPath);
        console.log(`🗑️  Removed file: ${targetPath}`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error; // Re-throw if it's not a "file not found" error
      }
      // File/directory doesn't exist, nothing to clean up
    }
  }

  /**
   * Get action state from previous run (if any)
   */
  getActionState() {
    try {
      const scanId = core.getState('scanId');
      const reportDir = core.getState('reportDir');
      const tempDir = core.getState('tempDir');
      
      return {
        scanId: scanId || null,
        reportDir: reportDir || './ada-reports',
        tempDir: tempDir || './ada-temp'
      };
    } catch (error) {
      console.warn('⚠️  Could not retrieve action state:', error.message);
      return {
        scanId: null,
        reportDir: './ada-reports',
        tempDir: './ada-temp'
      };
    }
  }
}

// Execute cleanup if this script is run directly
if (require.main === module) {
  const cleanup = new AdaCleanupAction();
  cleanup.run().catch(error => {
    console.error('Cleanup error (non-fatal):', error);
    // Don't exit with error code as cleanup failures shouldn't fail the action
    process.exit(0);
  });
}

module.exports = AdaCleanupAction;