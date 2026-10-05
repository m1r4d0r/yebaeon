window.YEBAEON_BUILD={number:'local',run:null,commit:'source',builtAt:'',changes:[]};
// 개발자도구 콘솔에 배포 번호와 최근 변경을 남긴다. 배포본에서는 빌드가 위 줄을 실제 값으로 바꾼다.
(function(){'use strict';const b=window.YEBAEON_BUILD;if(!b)return;
 console.info(`%c예배온 Studio 배포 #${b.number}`,'font-weight:bold;color:#3e55cf',`· 커밋 ${b.commit}${b.builtAt?' · '+b.builtAt+' 빌드':''}`);
 if(b.changes.length)console.info('최근 변경:\n'+b.changes.map(c=>'  · '+c).join('\n'));})();
