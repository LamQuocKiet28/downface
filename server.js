const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const root = __dirname;
const port = Number(process.env.PORT) || 3000;
const maxBodySize = 8 * 1024;
const allowedHosts = /(^|\.)facebook\.com$|(^|\.)fb\.watch$/i;
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};
const ffmpegBin = path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Packages", "Gyan.FFmpeg.Shared_Microsoft.Winget.Source_8wekyb3d8bbwe", "ffmpeg-9.0.1-full_build-shared", "bin");

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function parseRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBodySize) {
        reject(new Error("Dữ liệu gửi lên quá lớn."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Dữ liệu yêu cầu không hợp lệ."));
      }
    });
    request.on("error", reject);
  });
}

function validateFacebookUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("URL không hợp lệ.");
  }
  if (url.protocol !== "https:" || !allowedHosts.test(url.hostname)) {
    throw new Error("Chỉ hỗ trợ liên kết Facebook HTTPS công khai.");
  }
  return url.toString();
}

function findDownloadedFile(directory) {
  const files = fs.readdirSync(directory)
    .map((file) => path.join(directory, file))
    .filter((file) => /\.(mp4|mkv|webm|mov|m4a|mp3|aac|opus)$/i.test(file))
    .map((file) => ({ file, size: fs.statSync(file).size }))
    .sort((a, b) => b.size - a.size);
  if (!files.length) throw new Error("Không tìm thấy video tải xuống.");
  return files[0].file;
}

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const downloader = spawn("yt-dlp", args, {
      windowsHide: true,
      env: { ...process.env, PATH: `${ffmpegBin};${process.env.PATH || ""}` },
    });
    let errorOutput = "";
    let standardOutput = "";
    const timeout = setTimeout(() => {
      downloader.kill();
      reject(new Error("Tải video mất quá nhiều thời gian."));
    }, 120000);
    downloader.stderr.on("data", (chunk) => { errorOutput += chunk.toString(); });
    downloader.stdout.on("data", (chunk) => { standardOutput += chunk.toString(); });
    downloader.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    downloader.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(errorOutput.toLowerCase().includes("login") ? "Video này yêu cầu đăng nhập hoặc không công khai." : "Facebook không cho phép tải video này."));
        return;
      }
      resolve(standardOutput);
    });
  });
}

async function inspectVideo(url) {
  const output = await runYtDlp(["--no-playlist", "--no-warnings", "-J", url]);
  try {
    return JSON.parse(output);
  } catch {
    throw new Error("Không đọc được thông tin video.");
  }
}

function getFormats(info) {
  const seenVideo = new Set();
  const seenAudio = new Set();
  const videoFormats = (info.formats || [])
    .filter((format) => format.vcodec && format.vcodec !== "none" && format.url && format.format_id)
    .sort((a, b) => (b.height || 0) - (a.height || 0))
    .filter((format) => {
      if (seenVideo.has(format.height || format.format_id)) return false;
      seenVideo.add(format.height || format.format_id);
      return true;
    })
    .map((format) => ({
      id: format.format_id,
      label: format.height ? `${format.height}p` : "Video",
      height: format.height || 0,
      ext: format.ext || "mp4",
      hasAudio: Boolean(format.acodec && format.acodec !== "none"),
      type: "video",
    }));
  const video = videoFormats.filter((format) => format.hasAudio || !videoFormats.some((candidate) => candidate.height === format.height && candidate.hasAudio));
  const audio = (info.formats || [])
    .filter((format) => format.acodec && format.acodec !== "none" && (!format.vcodec || format.vcodec === "none") && format.url && format.format_id)
    .sort((a, b) => (b.abr || 0) - (a.abr || 0))
    .filter((format) => {
      if (seenAudio.has(format.ext || format.format_id)) return false;
      seenAudio.add(format.ext || format.format_id);
      return true;
    })
    .slice(0, 3)
    .map((format) => ({
      id: format.format_id,
      label: (format.ext || "m4a").toUpperCase(),
      height: 0,
      ext: format.ext || "m4a",
      hasAudio: true,
      type: "audio",
    }));
  const mp3 = audio[0] ? [{
    id: audio[0].id,
    label: "MP3",
    height: 0,
    ext: "mp3",
    hasAudio: true,
    type: "audio-mp3",
  }] : [];
  return [...video, ...audio, ...mp3];
}

function downloadVideo(url, formatId, audioFormat, directory) {
  if (!/^[\w.-]+$/.test(formatId)) throw new Error("Định dạng tải xuống không hợp lệ.");
  if (audioFormat === "mp3") {
    const output = path.join(directory, "audio.%(ext)s");
    return runYtDlp([
      "--no-playlist", "--no-warnings", "--restrict-filenames",
      "-f", formatId, "-x", "--audio-format", "mp3", "--audio-quality", "0",
      "-o", output, url,
    ]).then(() => findDownloadedFile(directory));
  }
  const output = path.join(directory, "video.%(ext)s");
  return runYtDlp(["--no-playlist", "--no-warnings", "--restrict-filenames", "-f", formatId, "-o", output, url])
    .then(() => findDownloadedFile(directory));
}

function serveStatic(request, response) {
  const requested = request.url === "/" ? "index.html" : request.url.slice(1);
  const filePath = path.resolve(root, requested.split("?")[0]);
  if (!filePath.startsWith(root + path.sep)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    response.end(data);
  });
}

const server = http.createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/api/formats") {
    try {
      const body = await parseRequestBody(request);
      const url = validateFacebookUrl(body.url);
      const info = await inspectVideo(url);
      json(response, 200, {
        title: info.title || "Facebook video",
        thumbnail: info.thumbnail || null,
        duration: info.duration || null,
        formats: getFormats(info),
      });
    } catch (error) {
      json(response, 400, { message: error.message || "Không thể phân tích video." });
    }
    return;
  }
  if (request.method === "POST" && request.url === "/api/download") {
    let directory;
    try {
      const body = await parseRequestBody(request);
      const url = validateFacebookUrl(body.url);
      const formatId = body.formatId || "best";
      directory = fs.mkdtempSync(path.join(os.tmpdir(), "downface-"));
      const filePath = await downloadVideo(url, formatId, body.audioFormat, directory);
      const extension = path.extname(filePath).slice(1) || "mp4";
      const filename = `downface-${crypto.randomUUID()}.${extension}`;
      response.writeHead(200, {
        "Content-Type": ["m4a", "mp3", "aac", "opus"].includes(extension) ? `audio/${extension === "m4a" ? "mp4" : extension}` : `video/${extension}`,
        "Content-Disposition": `attachment; filename="${filename}"`,
      });
      fs.createReadStream(filePath).pipe(response).on("finish", () => fs.rmSync(directory, { recursive: true, force: true }));
    } catch (error) {
      if (directory) fs.rmSync(directory, { recursive: true, force: true });
      json(response, 400, { message: error.message || "Không thể tải video." });
    }
    return;
  }
  if (request.method === "GET") {
    serveStatic(request, response);
    return;
  }
  response.writeHead(405);
  response.end("Method not allowed");
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Cổng ${port} đang được sử dụng. Hãy mở http://localhost:${port} hoặc chạy với PORT=3001.`);
    process.exitCode = 1;
    return;
  }
  throw error;
});

server.listen(port, () => {
  console.log(`DownFace đang chạy tại http://localhost:${port}`);
});
