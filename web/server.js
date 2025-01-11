const express = require("express");
const fs = require("fs");
const path = require("path");
const app = express();
const { spawn } = require("child_process");

app.use(express.json());

const BACKUP_DIR = "/backups";

// Serve static files from public directory
app.use(express.static(path.join(__dirname, "public")));

// API endpoints
app.get("/api/backups", (req, res) => {
  fs.readdir(BACKUP_DIR, (err, files) => {
    if (err) {
      return res.status(500).json({ error: "Failed to read backup directory" });
    }

    const backupFiles = files
      .filter((file) => file.endsWith(".dump"))
      .map((file) => {
        const stats = fs.statSync(path.join(BACKUP_DIR, file));
        return {
          name: file,
          size: stats.size,
          // Use mtime for the last modified date
          created: stats.mtime.toISOString(),
        };
      })
      // Sort files by creation date, newest first
      .sort((a, b) => new Date(b.created) - new Date(a.created));

    res.json(backupFiles);
  });
});

// Add download endpoint
app.get("/api/backups/download/:filename", (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join(BACKUP_DIR, filename);

  if (!filename.endsWith(".dump")) {
    return res.status(400).json({ error: "Invalid file type" });
  }

  // Check if file exists
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: "File not found" });
  }

  // Send file for download
  res.download(filepath, filename, (err) => {
    if (err) {
      res.status(500).json({ error: "Failed to download file" });
    }
  });
});

app.delete("/api/backups/:filename", (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join(BACKUP_DIR, filename);

  if (!filename.endsWith(".dump")) {
    return res.status(400).json({ error: "Invalid file type" });
  }

  fs.unlink(filepath, (err) => {
    if (err) {
      return res.status(500).json({ error: "Failed to delete file" });
    }
    res.json({ message: "File deleted successfully" });
  });
});

app.post("/api/backups/restore/:filename", (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join(BACKUP_DIR, filename);
  const { host, user, password, database } = req.body;

  // Validate input
  if (!filename.endsWith(".dump")) {
    return res.status(400).json({ error: "Invalid file type" });
  }

  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: "Backup file not found" });
  }

  if (!host || !user || !password || !database) {
    return res
      .status(400)
      .json({ error: "Missing required database connection parameters" });
  }

  const restoreProcess = spawn(
    "/usr/local/bin/pg_restore",
    [`--no-owner`, `-h`, host, `-U`, user, `-d`, database, `-F`, `c`, filepath],
    {
      env: { PGPASSWORD: password },
    }
  );

  restoreProcess.stdout.on("data", (data) => {
    console.log(`stdout: ${data}`);
  });

  restoreProcess.stderr.on("data", (data) => {
    console.error(`stderr: ${data}`);
  });

  restoreProcess.on("close", (code) => {
    if (code !== 0) {
      return res.status(500).json({
        error: "Restore failed",
        details: `Process exited with code ${code}`,
      });
    }
    res.json({
      message: "Restore completed successfully",
    });
  });
});

app.listen(3000, () => {
  console.log("Backup manager running on port 3000");
});
