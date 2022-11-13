﻿const dbName = 'SqliteStorage';

export function synchronizeFileWithIndexedDb(filename) {
    return new Promise((res, rej) => {
        const db = window.indexedDB.open(dbName, 1);
        db.onupgradeneeded = () => {
            db.result.createObjectStore("Files", { keypath: "id" });
            console.log("onupgradeneeded");
        };

        db.onsuccess = () => {
            const req = db.result
                .transaction("Files", "readonly")
                .objectStore("Files")
                .get("file");
            req.onsuccess = () => {
                console.log("onsuccess");
                window.Module.FS_createDataFile(
                    "/",
                    filename,
                    req.result,
                    true,
                    true,
                    true
                );
                res();
            };
        };

        let lastModifiedTime = new Date();
        setInterval(() => {
            const path = `/${filename}`;
            if (window.Module.FS.analyzePath(path).exists) {
                const mtime = window.Module.FS.stat(path).mtime;
                if (mtime.valueOf() !== lastModifiedTime.valueOf()) {
                    lastModifiedTime = mtime;
                    const data = window.Module.FS.readFile(path);
                    db.result
                        .transaction("Files", "readwrite")
                        .objectStore("Files")
                        .put(data, "file");
                }
            }
        }, 1000);
    });
}

export function deleteIndexedDb() {
    window.indexedDB.deleteDatabase(dbName);
}