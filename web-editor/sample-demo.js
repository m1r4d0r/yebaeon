// Synthetic example for source sharing. Contains no church documents or media.
// pp6.js is loaded first so this uses the same RTF writer as the editor.
(function () {
  'use strict';
  const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const examples = [
    {group:'시작', label:'예배온 Studio', text:'예배온 Studio\n예배 자료를 준비하는 공간', font:'Arita-buri-Medium_OTF', color:'0.08 0.12 0.22 1'},
    {group:'편집', label:'문서 편집 안내', text:'문서 열기로 .pro6 파일을 불러오세요\n텍스트와 슬라이드 순서를 편집할 수 있습니다', font:'NanumGothic', color:'0.08 0.20 0.20 1'},
    {group:'저장', label:'저장 안내', text:'입장하면 문서를 서버에 저장할 수 있어요\n교회에서는 PP6로 최종 확인해 주세요', font:'NanumMyeongjo', color:'0.20 0.13 0.19 1'}
  ];
  const groups = examples.map((item, index) => {
    const base = index * 3 + 1;
    const rtf = window.PP6.textRTF(item.text, {font:item.font, size:80, color:'rgb(255,255,255)', align:'center', bold:false});
    return `<RVSlideGrouping UUID="${id(base)}" name="${item.group}" color="${item.color}">
      <array rvXMLIvarName="slides">
        <RVDisplaySlide UUID="${id(base+1)}" label="${item.label}" drawingBackgroundColor="true" backgroundColor="${item.color}" enabled="true">
          <array rvXMLIvarName="displayElements">
            <RVTextElement UUID="${id(base+2)}" opacity="1" verticalAlignment="0" drawingFill="false" drawingShadow="false">
              <RVRect3D rvXMLIvarName="position">{120 240 0 1680 600}</RVRect3D>
              <NSString rvXMLIvarName="RTFData">${rtf}</NSString>
            </RVTextElement>
          </array>
          <array rvXMLIvarName="cues"/>
        </RVDisplaySlide>
      </array>
    </RVSlideGrouping>`;
  }).join('\n');
  window.PP6_SAMPLE = {
    name:'예배온-예제.pro6',
    xml:`<?xml version="1.0" encoding="UTF-8"?>
<RVPresentationDocument UUID="${id(0)}" versionNumber="600" width="1920" height="1080">
  <array rvXMLIvarName="groups">${groups}</array>
</RVPresentationDocument>`
  };
})();
