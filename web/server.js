// server.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const app = express();
const { spawn } = require("child_process");
require("dotenv").config();

app.use(express.json());

const BACKUP_DIR = "/backups";

// Serve static files from public directory
app.use(express.static(path.join(__dirname, "public")));

// API endpoints
app.get("/api/backups", (req, res) => {
  fs.readdir(BACKUP_DIR, (err, files) => {
    if (err) {
      console.error("Error reading backup directory:", err);
      return res.status(500).json({ error: "Failed to read backup directory" });
    }

    try {
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
    } catch (error) {
      console.error("Error processing backup files:", error);
      res.status(500).json({ error: "Failed to process backup files" });
    }
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
      console.error("Error downloading file:", err);
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
      console.error("Error deleting file:", err);
      return res.status(500).json({ error: "Failed to delete file" });
    }
    res.json({ message: "File deleted successfully" });
  });
});

// New endpoint for instant backup
app.post("/api/backups/create", (req, res) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(
    BACKUP_DIR,
    `pg_backup_manual_${timestamp}.dump`
  );
  const { host, user, password, database } = req.body;

  // Validate input
  if (!host || !user || !password || !database) {
    return res.status(400).json({
      error: "Missing required database connection parameters",
    });
  }

  console.log(`Creating backup: ${backupFile}`);

  const pgDump = spawn(
    "pg_dump",
    [
      `-h`,
      host,
      `-U`,
      user,
      `-d`,
      database,
      `-Fc`, // Custom format
      `-j 8`,
      `-Z`,
      `9`, // Maximum compression
      `-f`,
      backupFile,
    ],
    {
      env: { PGPASSWORD: password },
    }
  );

  let errorOutput = "";

  pgDump.stdout.on("data", (data) => {
    console.log(`stdout: ${data}`);
  });

  pgDump.stderr.on("data", (data) => {
    errorOutput += data.toString();
    console.error(`stderr: ${data}`);
  });

  pgDump.on("close", (code) => {
    if (code !== 0) {
      console.error(`Backup process exited with code ${code}`);
      return res.status(500).json({
        error: "Backup failed",
        details: errorOutput || `Process exited with code ${code}`,
      });
    }

    res.json({
      message: "Backup created successfully",
      file: path.basename(backupFile),
    });
  });
});

app.post("/api/backups/restore/:filename", (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join(BACKUP_DIR, filename);
  const { host, user, password, database, port = 5432 } = req.body;

  // Validate file extension
  if (!filename.endsWith(".dump")) {
    return res
      .status(400)
      .json({ error: "Invalid file type. Only .dump is allowed." });
  }

  // Check if file exists
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: "Backup file not found" });
  }

  // Validate DB connection info
  if (!host || !user || !password || !database) {
    return res
      .status(400)
      .json({ error: "Missing required database connection parameters" });
  }

  console.log(
    `Restoring ${filename} to database "${database}" on host "${host}"...`
  );

  let errorOutput = "";

  const restoreProcess = spawn(
    "pg_restore",
    [
      "--no-owner",
      "--clean",
      "--if-exists",
      "-h",
      host,
      "-p",
      String(port),
      "-U",
      user,
      "-d",
      database,
      "-F",
      "c", // Format: custom
      filepath,
    ],
    {
      env: { ...process.env, PGPASSWORD: password },
    }
  );

  restoreProcess.stdout.on("data", (data) => {
    console.log(`stdout: ${data}`);
  });

  restoreProcess.stderr.on("data", (data) => {
    errorOutput += data.toString();
    console.error(`stderr: ${data}`);
  });

  restoreProcess.on("close", (code) => {
    const fatalError =
      code !== 0 &&
      errorOutput.includes("ERROR:") &&
      !errorOutput.includes("already exists") &&
      !errorOutput.includes("does not exist");

    if (fatalError) {
      return res.status(500).json({
        error: "Restore failed",
        details: errorOutput,
        exitCode: code,
      });
    }

    res.json({
      message: "Restore completed",
      warnings: code !== 0 ? "Some non-fatal issues occurred" : null,
    });
  });
});

app.post("/api/backups/create/env", (req, res) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(BACKUP_DIR, `pg_backup_env_${timestamp}.dump`);

  const {
    POSTGRES_HOST: host,
    POSTGRES_USER: user,
    POSTGRES_PASSWORD: password,
    POSTGRES_DB: database,
  } = process.env;

  // Validate environment variables
  if (!host || !user || !password || !database) {
    return res.status(500).json({
      error: "Missing required environment variables",
    });
  }

  console.log(`Creating backup from ENV: ${backupFile}`);

  const pgDump = spawn(
    "pg_dump",
    [
      "-h",
      host,
      "-U",
      user,
      "-d",
      database,
      "-Fc",
      "-Z",
      "9",
      "-f",
      backupFile,
    ],
    {
      env: {
        ...process.env,
        PGPASSWORD: password,
      },
    }
  );

  let errorOutput = "";

  pgDump.stdout.on("data", (data) => {
    console.log(`stdout: ${data}`);
  });

  pgDump.stderr.on("data", (data) => {
    errorOutput += data.toString();
    console.error(`stderr: ${data}`);
  });

  pgDump.on("close", (code) => {
    if (code !== 0) {
      console.error(`Backup process exited with code ${code}`);
      return res.status(500).json({
        error: "Backup failed",
        details: errorOutput || `Process exited with code ${code}`,
      });
    }

    res.json({
      message: "Backup created successfully using env variables",
      file: path.basename(backupFile),
    });
  });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(3003, () => {
  console.log("Backup manager running on port 3003");
});
