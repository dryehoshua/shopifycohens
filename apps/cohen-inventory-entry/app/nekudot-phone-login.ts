export function phoneSessionScript(token?: string, resume = false, clear = false) {
  const serialized = JSON.stringify(token || "").replaceAll("<", "\\u003c");
  return `<script>(function(){
    var key='cohens-nekudot-phone-session';
    try {
      ${clear ? "sessionStorage.removeItem(key);" : ""}
      var incoming=${serialized};
      if(incoming) sessionStorage.setItem(key,incoming);
      var token=sessionStorage.getItem(key)||'';
      if(!/^[A-Za-z0-9_-]{43}$/.test(token)) return;
      document.addEventListener('submit',function(event){
        var form=event.target;
        if(!String(form.getAttribute('action')||'').startsWith('/apps/nekudot')) return;
        if(form.querySelector('[name="phoneSession"]')) return;
        var input=document.createElement('input');input.type='hidden';input.name='phoneSession';input.value=token;form.appendChild(input);
      },true);
      ${resume ? `var form=document.createElement('form');form.method='post';form.action='/apps/nekudot';
      [['intent','phone_resume'],['phoneSession',token]].forEach(function(pair){var input=document.createElement('input');input.type='hidden';input.name=pair[0];input.value=pair[1];form.appendChild(input);});
      document.body.appendChild(form);form.submit();` : ""}
    } catch(error) { /* The email option remains available if session storage is disabled. */ }
  })();</script>`;
}
