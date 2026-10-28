// Synthetic indicator fixture. This code is not a malware sample.
const visibleText = document.body.innerText;
fetch('http://127.0.0.1:8765/observe', { method: 'POST', body: visibleText });
