const units = {zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,
  thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
const numericWord = token => Object.hasOwn(units,token) || ['hundred','thousand'].includes(token) || /^\d+(?:\.\d+)?k?$/.test(token);

// Only used for an answer to a budget question or an explicit budget statement.
// Ambiguous amounts stay unknown; nothing here qualifies a lead or quotes a band.
export function parseSpokenBudget(text = '') {
  if (/\$|\beuros?|\bdollars?|\bminus\b|\bnegative\b/i.test(text)) return undefined;
  const value = text.toLowerCase().replace(/(\d),(?=\d{3}\b)/g,'$1').replace(/-/g,' ');
  const currency = [...value.matchAll(/£\s*(\d+(?:\.\d+)?)(k)?/g)].map(match=>Number(match[1])*(match[2]?1000:1));
  const groups = []; let current = [];
  for (const token of value.match(/[a-z]+|\d+(?:\.\d+)?k?/g) || []) {
    if (numericWord(token) || token === 'and' && current.length) current.push(token);
    else if (current.length) { groups.push(current); current=[]; }
  }
  if (current.length) groups.push(current);
  const amounts = currency.length ? currency : groups.map(tokens=>{
    let total=0, part=0;
    for(const token of tokens) {
      if(token==='and') continue;
      if(token==='hundred') part=Math.max(part,1)*100;
      else if(token==='thousand') {total+=Math.max(part,1)*1000;part=0;}
      else part+=Object.hasOwn(units,token)?units[token]:Number(token.replace(/k$/,''))*(token.endsWith('k')?1000:1);
    }
    return total+part;
  });
  if (!amounts.length) return /\b(?:not sure|undecided|don['’]?t know|not decided|no budget yet)\b/.test(value)?0:undefined;
  if (amounts.length > 1 && !/\b(?:between|to|range)\b|\d\s*[-–—]\s*\d/i.test(text)) return undefined;
  const amount=Math.max(...amounts);
  return Number.isFinite(amount)&&amount>=0&&amount<=1000000?amount:undefined;
}

const incomplete = text => /^(?:it(?:['’]s| is)|the|um|erm|uh|er|let me (?:think|check)|one moment|hold on)[\s.!…,-]*$/i.test(text.trim());
const isAnswer = text => text.length>=3 && !/^(?:yes|yeah|yep|no|okay|ok|correct|thanks|thank you|not sure)[\s.!?]*$/i.test(text);

export function createVoiceAnswerCapture() {
  let question='', facts={}, hornMentioned=false;
  return {
    isIncomplete:incomplete,
    observeAssistant(text='') {
      if (!/\?|\b(?:please (?:tell|share|give|confirm)|just tell me)\b/i.test(text)) return;
      question=/\bbudget\b|\bhow much\b.*\b(?:spend|pay)\b/i.test(text)?'budget'
        : /\b(?:venue|town|county|postcode|location)\b/i.test(text) && !/\b(?:is that|correct venue|confirm|right venue)\b/i.test(text)?'venue':'';
    },
    acceptUser(text='') {
      const captured={};
      if (/\b(?:brass|horn section|horn players)\b/i.test(text) && !/\b(?:don['’]?t|do not|didn['’]?t|did not|haven['’]?t|never|no|not)\b[^.!?]*\b(?:brass|horn)\b/i.test(text)) hornMentioned=true;
      if (question==='budget' || /\b(?:my|our|the) budget\b|\bbudget (?:is|of|around|about)\b/i.test(text)) {
        const amount=parseSpokenBudget(text); if(amount!==undefined) captured.maxBudget=amount;
      }
      if ((question==='venue' || /\b(?:the|our|my) venue is\b/i.test(text)) && isAnswer(text.trim()) && !incomplete(text)) {
        const address=text.trim().replace(/^(?:it['’]s|it is|the venue is|our venue is|my venue is)\s+/i,'').slice(0,400);
        if(address.length>=3) {captured.address=address;captured.county='';captured.postcode='';}
      }
      facts={...facts,...captured};
      return captured;
    },
    venueResult(result) {
      if (result?.venues?.length===1) {
        const venue=result.venues[0]; facts={...facts,address:venue.address,county:venue.county||'',postcode:venue.postcode||''};
      }
    },
    mergeInput(input={}) { return {...input,...facts}; },
    context() {
      return `Caller answers already checkpointed (still unconfirmed draft details): ${JSON.stringify(facts)}. Preserve these when saving; do not replace a known budget with zero or omit the venue. Speak of a 'horn section, such as saxophone and trumpet', rather than the standalone word 'brass'. Never introduce a horn-section clarification unless the caller actually asked about it. Caller raised horn section: ${hornMentioned}.`;
    },
    get hornMentioned(){return hornMentioned;},
  };
}
