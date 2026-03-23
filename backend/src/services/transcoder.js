const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// HLS transcoding quality profiles
const QUALITY_PROFILES = [
  {
    name: '480p',
    resolution: '854x480',
    videoBitrate: '1000k',
    audioBitrate: '96k',
    maxrate: '1200k',
    bufsize: '2000k'
  },
  {
    name: '720p',
    resolution: '1280x720',
    videoBitrate: '2500k',
    audioBitrate: '128k',
    maxrate: '3000k',
    bufsize: '4000k'
  },
  {
    name: '1080p',
    resolution: '1920x1080',
    videoBitrate: '5000k',
    audioBitrate: '192k',
    maxrate: '6000k',
    bufsize: '8000k'
  }
];

/**
 * Get video duration and metadata using ffprobe
 */
function getVideoInfo(filePath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ];

    const proc = spawn('ffprobe', args);
    let output = '';
    let errorOutput = '';

    proc.stdout.on('data', (data) => { output += data.toString(); });
    proc.stderr.on('data', (data) => { errorOutput += data.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`ffprobe exited with code ${code}: ${errorOutput}`));
      }
      try {
        const info = JSON.parse(output);
        const videoStream = info.streams?.find(s => s.codec_type === 'video');
        resolve({
          duration: parseFloat(info.format?.duration || 0),
          width: videoStream?.width || 0,
          height: videoStream?.height || 0,
          bitrate: parseInt(info.format?.bit_rate || 0),
          size: parseInt(info.format?.size || 0)
        });
      } catch (e) {
        reject(new Error(`Failed to parse ffprobe output: ${e.message}`));
      }
    });
  });
}

/**
 * Generate a thumbnail from the video
 */
function generateThumbnail(inputPath, outputPath, timestamp = '00:00:05') {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-ss', timestamp,
      '-vframes', '1',
      '-q:v', '2',
      '-vf', 'scale=640:-1',
      '-y',
      outputPath
    ];

    const proc = spawn('ffmpeg', args);
    let errorOutput = '';
    proc.stderr.on('data', (data) => { errorOutput += data.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Thumbnail generation failed: ${errorOutput}`));
      }
      resolve(outputPath);
    });
  });
}

/**
 * Transcode a video to HLS with adaptive bitrate
 * Returns progress updates via callback
 */
function transcodeToHLS(inputPath, outputDir, onProgress) {
  return new Promise((resolve, reject) => {
    // Create output directory
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Determine which quality levels to create based on source resolution
    const getApplicableProfiles = async () => {
      try {
        const info = await getVideoInfo(inputPath);
        return QUALITY_PROFILES.filter(p => {
          const profileHeight = parseInt(p.resolution.split('x')[1]);
          return profileHeight <= Math.max(info.height, 480); // Always include 480p minimum
        });
      } catch (_e) {
        return QUALITY_PROFILES; // If probe fails, try all
      }
    };

    getApplicableProfiles().then((profiles) => {
      // Build the FFmpeg command for multi-quality HLS
      const args = ['-i', inputPath, '-y'];

      // Add output for each quality profile
      profiles.forEach((profile, index) => {
        const profileDir = path.join(outputDir, profile.name);
        if (!fs.existsSync(profileDir)) {
          fs.mkdirSync(profileDir, { recursive: true });
        }

        args.push(
          `-map`, `0:v:0`, `-map`, `0:a:0`,
          `-c:v:${index}`, 'libx264',
          `-b:v:${index}`, profile.videoBitrate,
          `-maxrate:v:${index}`, profile.maxrate,
          `-bufsize:v:${index}`, profile.bufsize,
          `-s:v:${index}`, profile.resolution,
          `-c:a:${index}`, 'aac',
          `-b:a:${index}`, profile.audioBitrate,
          `-preset`, 'medium',
          `-g`, '48',
          `-keyint_min`, '48',
          `-sc_threshold`, '0'
        );
      });

      // HLS output options
      args.push(
        '-f', 'hls',
        '-hls_time', '6',
        '-hls_playlist_type', 'vod',
        '-hls_flags', 'independent_segments',
        '-hls_segment_type', 'mpegts',
        '-hls_segment_filename', path.join(outputDir, '%v/segment_%03d.ts'),
        '-master_pl_name', 'master.m3u8',
        '-var_stream_map', profiles.map((_, i) => `v:${i},a:${i}`).join(' ')
      );

      // Output playlist per variant
      args.push(path.join(outputDir, '%v/playlist.m3u8'));

      console.log('🎬 Starting HLS transcode:', profiles.map(p => p.name).join(', '));

      const proc = spawn('ffmpeg', args);
      let errorOutput = '';
      let duration = 0;

      proc.stderr.on('data', (data) => {
        const str = data.toString();
        errorOutput += str;

        // Parse duration
        const durMatch = str.match(/Duration: (\d{2}):(\d{2}):(\d{2})/);
        if (durMatch) {
          duration = parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseInt(durMatch[3]);
        }

        // Parse progress
        const timeMatch = str.match(/time=(\d{2}):(\d{2}):(\d{2})/);
        if (timeMatch && duration > 0 && onProgress) {
          const currentTime = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]);
          const progress = Math.min(Math.round((currentTime / duration) * 100), 100);
          onProgress(progress);
        }
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(`FFmpeg transcode failed (exit ${code}): ${errorOutput.slice(-500)}`));
        }

        // Rename variant directories to use profile names
        const masterPath = path.join(outputDir, 'master.m3u8');
        if (fs.existsSync(masterPath)) {
          let masterContent = fs.readFileSync(masterPath, 'utf-8');
          profiles.forEach((profile, i) => {
            // FFmpeg uses numeric names (0, 1, 2) — rename to profile names
            const srcDir = path.join(outputDir, String(i));
            const dstDir = path.join(outputDir, profile.name);
            if (fs.existsSync(srcDir) && srcDir !== dstDir) {
              if (fs.existsSync(dstDir)) fs.rmSync(dstDir, { recursive: true });
              fs.renameSync(srcDir, dstDir);
            }
            masterContent = masterContent.replace(
              new RegExp(`${i}/playlist\\.m3u8`, 'g'),
              `${profile.name}/playlist.m3u8`
            );
          });
          fs.writeFileSync(masterPath, masterContent);
        }

        console.log('✅ HLS transcode complete:', outputDir);
        resolve({
          masterPlaylist: masterPath,
          profiles: profiles.map(p => p.name)
        });
      });
    }).catch(reject);
  });
}

module.exports = { transcodeToHLS, getVideoInfo, generateThumbnail, QUALITY_PROFILES };
