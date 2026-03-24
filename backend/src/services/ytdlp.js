const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

/**
 * Download a YouTube video using yt-dlp
 */
function downloadVideo(url, outputDir) {
  return new Promise((resolve, reject) => {
    const filename = `${uuidv4()}`;
    const outputTemplate = path.join(outputDir, `${filename}.%(ext)s`);

    // Check for cookies file (bind-mounted at /data/cookies.txt, or local fallback)
    const cookieSources = ['/data/cookies.txt', path.join(outputDir, '..', 'cookies.txt')];
    const cookieSource = cookieSources.find(p => fs.existsSync(p));
    let cookiesPath = null;

    // Copy cookies to writable temp file (bind mount may be read-only)
    if (cookieSource) {
      cookiesPath = path.join(outputDir, `cookies-${filename}.txt`);
      fs.copyFileSync(cookieSource, cookiesPath);
    }

    const args = [
      url,
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '-o', outputTemplate,
      '--write-info-json',
      '--no-playlist',
      '--no-overwrites',
      '--restrict-filenames',
      // Use Node.js as JS runtime (yt-dlp calls it 'node')
      '--js-runtimes', 'node',
      // Use player clients that support cookies
      '--extractor-args', 'youtube:player_client=mweb,web_creator',
      // Network flags
      '--force-ipv4',
      '--geo-bypass',
      // The best current combo to avoid bot detection: mobile clients
      // Web client is the one that gets the "Sign in to confirm" wall
      '--extractor-args', 'youtube:player_client=android,ios,mweb',
      '--extractor-args', 'youtube:player_skip=web,web_creator',
      '--sleep-requests', '1',
      // Browser user-agent
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    ];

    // Use cookies if available (needed for YouTube bot detection)
    if (cookiesPath) {
      args.push('--cookies', cookiesPath);
      // Optional: ignore cookie errors so it falls back to unauthenticated
      args.push('--compat-options', 'no-keep-subscription');
      console.log('🍪 Using cookies for YouTube auth');
    }

    console.log(`📥 Downloading: ${url}`);

    const proc = spawn('yt-dlp', args);
    let errorOutput = '';

    proc.stdout.on('data', (data) => {
      const progressMatch = data.toString().match(/(\d+\.?\d*)%/);
      if (progressMatch) {
        process.stdout.write(`\r  Download: ${progressMatch[1]}%`);
      }
    });

    proc.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    proc.on('close', (code) => {
      // Clean up temp cookies file
      if (cookiesPath && fs.existsSync(cookiesPath)) {
        try { fs.unlinkSync(cookiesPath); } catch (_e) { /* ignore */ }
      }

      if (code !== 0) {
        return reject(new Error(`yt-dlp failed (exit ${code}): ${errorOutput}`));
      }

      // Find the downloaded file
      const files = fs.readdirSync(outputDir).filter(f => f.startsWith(filename) && !f.endsWith('.json'));
      if (files.length === 0) {
        return reject(new Error('yt-dlp did not produce an output file'));
      }

      const videoFile = files[0];
      const videoPath = path.join(outputDir, videoFile);
      const stat = fs.statSync(videoPath);

      // Try to read the info JSON
      let metadata = {};
      const infoJsonPath = path.join(outputDir, `${filename}.info.json`);
      if (fs.existsSync(infoJsonPath)) {
        try {
          const infoJson = JSON.parse(fs.readFileSync(infoJsonPath, 'utf-8'));
          metadata = {
            title: infoJson.title || 'Untitled',
            description: infoJson.description || '',
            duration: infoJson.duration || 0,
            uploader: infoJson.uploader || '',
            thumbnail_url: infoJson.thumbnail || ''
          };
          // Clean up the info JSON
          fs.unlinkSync(infoJsonPath);
        } catch (e) {
          console.warn('Could not parse info JSON:', e.message);
        }
      }

      console.log(`\n✅ Downloaded: ${videoFile} (${(stat.size / 1048576).toFixed(1)} MB)`);

      resolve({
        filename: videoFile,
        path: videoPath,
        size: stat.size,
        metadata,
        sourceUrl: url
      });
    });
  });
}

/**
 * Check if yt-dlp is installed
 */
function isYtdlpAvailable() {
  try {
    const { execSync } = require('child_process');
    execSync('yt-dlp --version', { stdio: 'pipe' });
    return true;
  } catch (_e) {
    return false;
  }
}

module.exports = { downloadVideo, isYtdlpAvailable };
