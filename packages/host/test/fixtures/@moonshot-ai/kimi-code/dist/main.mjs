const portIndex = process.argv.indexOf("--port");
const port = portIndex >= 0 ? process.argv[portIndex + 1] : "0";
process.stdout.write(`Kimi server: http://127.0.0.1:${port}/#token=mock-token\n`);
setInterval(() => {}, 1000);
