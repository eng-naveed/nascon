/**
 * Self-contained WHIP publisher page for the Go live WebView (FR-3.2).
 *
 * Why not MediaMTX's own /publish page: the WebView would load it from http://<LAN IP>:8889, which is not a secure
 * context, so getUserMedia is undefined ("can't access webcams or microphones"). Loaded as inline HTML with a
 * http://localhost base URL instead, the page IS a secure context and can open the camera; it then POSTs the SDP
 * offer cross-origin to the WHIP endpoint (MediaMTX sends webrtcAllowOrigin '*').
 *
 * MediaMTX runs in Docker and answers with host candidates on its container IP, which a phone cannot reach. UDP
 * 8189 is published on the laptop, so candidates are rewritten to the host the phone already used for HTTP.
 */
export function whipPublisherHtml(whipUrl: string): string {
  const cfg = JSON.stringify({ whipUrl }).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#000;color:#fff;font:15px system-ui,sans-serif}
video{width:100%;height:100%;object-fit:cover}
#s{position:absolute;left:12px;top:12px;padding:6px 10px;border-radius:999px;background:rgba(0,0,0,.6);font-weight:700}
#s.live{background:#FF3B5C}#s.err{background:#7a1f2b}</style></head>
<body><video id="v" autoplay playsinline muted></video><div id="s">Starting camera…</div>
<script>(function(){
var C=${cfg};var s=document.getElementById('s');
function st(t,c){s.textContent=t;s.className=c||'';try{window.ReactNativeWebView.postMessage(JSON.stringify({state:c||'info',text:t}));}catch(e){}}
var host=new URL(C.whipUrl).hostname;
function fixCandidates(sdp){return sdp.replace(/^(a=candidate:\\S+ \\d+ udp \\d+ )(\\S+)( \\d+ typ host.*)$/gim,function(_m,a,_ip,b){return a+host+b;});}
/* HLS viewers cannot play VP8 (the WebView default): offer H264 first, then VP9, so MediaMTX can remux to HLS */
function rank(c){return /h264/i.test(c.mimeType)?0:/vp9/i.test(c.mimeType)?1:2;}
function preferHlsCodecs(tr){if(!tr.setCodecPreferences)return;
  [window.RTCRtpReceiver,window.RTCRtpSender].some(function(K){try{var cs=K&&K.getCapabilities&&K.getCapabilities('video');
    if(!cs)return false;tr.setCodecPreferences(cs.codecs.slice().sort(function(a,b){return rank(a)-rank(b);}));return true;}catch(e){return false;}});}
if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){st('Camera not available in this view','err');return;}
var facing='user',stream=null,pc=null,v=document.getElementById('v');
function cam(f){return navigator.mediaDevices.getUserMedia({video:{facingMode:f,width:{ideal:1280},height:{ideal:720}},audio:false});}
function mirror(){v.style.transform=facing==='user'?'scaleX(-1)':'none';}
/* controls called from the app via injectJavaScript */
window.__flip=function(){var next=facing==='user'?'environment':'user';
  cam(next).then(function(s2){var nt=s2.getVideoTracks()[0],old=stream.getVideoTracks()[0];
    var snd=pc&&pc.getSenders().filter(function(x){return x.track&&x.track.kind==='video';})[0];
    return (snd?snd.replaceTrack(nt):Promise.resolve()).then(function(){stream.removeTrack(old);old.stop();stream.addTrack(nt);facing=next;v.srcObject=stream;mirror();
      try{window.ReactNativeWebView.postMessage(JSON.stringify({facing:facing}));}catch(e){}});
  }).catch(function(){st('Could not switch camera','err');});};
window.__mute=function(on){if(!stream)return;stream.getAudioTracks().forEach(function(t){t.enabled=!on;});
  try{window.ReactNativeWebView.postMessage(JSON.stringify({muted:!!on}));}catch(e){}};
navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1280},height:{ideal:720}},audio:true}).then(function(ms){
  stream=ms;v.srcObject=stream;mirror();st('Connecting…');
  pc=new RTCPeerConnection({iceServers:[]});
  stream.getTracks().forEach(function(t){var tr=pc.addTransceiver(t,{direction:'sendonly'});if(t.kind==='video')preferHlsCodecs(tr);});
  pc.onconnectionstatechange=function(){var c=pc.connectionState;
    if(c==='connected')st('LIVE','live');else if(c==='failed')st('Connection failed. Is the phone on the same Wi-Fi as the server?','err');else if(c==='disconnected')st('Reconnecting…');};
  return pc.createOffer().then(function(o){return pc.setLocalDescription(o);}).then(function(){
    return new Promise(function(res){if(pc.iceGatheringState==='complete')return res();var t=setTimeout(res,1500);
      pc.onicegatheringstatechange=function(){if(pc.iceGatheringState==='complete'){clearTimeout(t);res();}};});
  }).then(function(){return fetch(C.whipUrl,{method:'POST',headers:{'Content-Type':'application/sdp'},body:pc.localDescription.sdp});})
  .then(function(r){if(r.status!==201&&r.status!==200)throw new Error(r.status===401||r.status===409?'Stream key is not active':'Server refused the stream ('+r.status+')');return r.text();})
  .then(function(ans){return pc.setRemoteDescription({type:'answer',sdp:fixCandidates(ans)});});
}).catch(function(e){st((e&&e.name==='NotAllowedError')?'Camera or microphone permission denied':(e&&e.message)||'Could not start the broadcast','err');});
})();</script></body></html>`;
}
