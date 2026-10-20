# CLIPTORA Database Fix

Fixes MySQL error 1049: Unknown database `cliptora_v2`. The previous initializer was building a MySQL server connection URL without actually removing the database path.

Extract this archive into the existing `C:\xampp\htdocs\CLIPTORA` project folder, preserving the paths and overwriting `backend/app/init_db.py`. Do not delete your project or `.git` folder.

Start MySQL in XAMPP and run:

```powershell
cd C:\xampp\htdocs\CLIPTORA
powershell -ExecutionPolicy Bypass -File .\scripts\init-database.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\start-all.ps1
```

If it still fails with MySQL 1045 (access denied), review `backend/.env` database credentials. This fix never deletes tables, databases, Git history or uploaded files.
