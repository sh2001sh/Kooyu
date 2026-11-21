const terminal = new Terminal({ cols: 44, rows: 18, fontSize: 12, scrollback: 500 });
terminal.open(document.getElementById("screen"));
terminal.onData((text) => TerminalInput.send(text));
window.renderTerminal = (text, reset) => {
  if (reset) terminal.reset();
  terminal.write(text);
};
