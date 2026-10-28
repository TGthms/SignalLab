// FCC 47 CFR § 11.31(e), accessed 28 October 2026. Names are the FCC's
// English descriptions; a code here does not authorize transmitting it.
export const EAS_EVENTS = Object.freeze({
 EAN:'Emergency Action Notification (National only)', NIC:'National Information Center', NPT:'National Periodic Test', RMT:'Required Monthly Test', RWT:'Required Weekly Test',
 ADR:'Administrative Message', AVW:'Avalanche Warning', AVA:'Avalanche Watch', BZW:'Blizzard Warning', BLU:'Blue Alert', CAE:'Child Abduction Emergency', CDW:'Civil Danger Warning', CEM:'Civil Emergency Message', CFW:'Coastal Flood Warning', CFA:'Coastal Flood Watch', DSW:'Dust Storm Warning', EQW:'Earthquake Warning', EVI:'Evacuation Immediate', EWW:'Extreme Wind Warning', FRW:'Fire Warning', FFW:'Flash Flood Warning', FFA:'Flash Flood Watch', FFS:'Flash Flood Statement', FLW:'Flood Warning', FLA:'Flood Watch', FLS:'Flood Statement', HMW:'Hazardous Materials Warning', HWW:'High Wind Warning', HWA:'High Wind Watch', HUW:'Hurricane Warning', HUA:'Hurricane Watch', HLS:'Hurricane Statement', LEW:'Law Enforcement Warning', LAE:'Local Area Emergency', MEP:'Missing and Endangered Persons', NMN:'Network Message Notification', TOE:'911 Telephone Outage Emergency', NUW:'Nuclear Power Plant Warning', DMO:'Practice / Demo Warning', RHW:'Radiological Hazard Warning', SVR:'Severe Thunderstorm Warning', SVA:'Severe Thunderstorm Watch', SVS:'Severe Weather Statement', SPW:'Shelter in Place Warning', SMW:'Special Marine Warning', SPS:'Special Weather Statement', SSA:'Storm Surge Watch', SSW:'Storm Surge Warning', TOR:'Tornado Warning', TOA:'Tornado Watch', TRW:'Tropical Storm Warning', TRA:'Tropical Storm Watch', TSW:'Tsunami Warning', TSA:'Tsunami Watch', VOW:'Volcano Warning', WSW:'Winter Storm Warning', WSA:'Winter Storm Watch',
});

// Brief study explanations, paraphrased from FCC, NWS, and FEMA references.
// A code identifies a class of alert, not its complete message or instructions.
export const EVENT_GROUPS = Object.freeze([
 {name:'National messages', codes:['EAN','NIC','NPT']},
 {name:'Tests and administration', codes:['RWT','RMT','DMO','ADR','NMN']},
 {name:'Weather and natural hazards', codes:['AVA','AVW','BZW','CFA','CFW','DSW','EQW','EWW','FFA','FFW','FFS','FLA','FLW','FLS','HWA','HWW','HUA','HUW','HLS','SVA','SVR','SVS','SMW','SPS','SSA','SSW','TOA','TOR','TRA','TRW','TSA','TSW','VOW','WSA','WSW']},
 {name:'Public safety and other emergencies', codes:['BLU','CAE','CDW','CEM','EVI','FRW','HMW','LEW','LAE','MEP','TOE','NUW','RHW','SPW']},
]);
export const EVENT_EXPLANATIONS = Object.freeze({
 EAN:'A national-level activation for an emergency message.', NIC:'A national information center code listed by the FCC; consult the applicable plan for its use.', NPT:'A test of the national alerting system.', RWT:'A regularly scheduled weekly test of alerting equipment.', RMT:'A regularly scheduled monthly test of alerting equipment.', DMO:'A demonstration or exercise under an applicable alerting plan.', ADR:'An administrative update, such as preparation, recovery, or a status update.', NMN:'A network message notification code; the NWS says it is not defined for its relay products.',
 BLU:'Information about a suspect in a serious attack on a law enforcement officer, when applicable criteria are met.', CAE:'A missing-child emergency in which abduction is suspected and established criteria are met.', CDW:'A specific danger to a significant civilian population, often with protective instructions.', CEM:'An imminent or ongoing significant civil threat to public safety or property.', EVI:'Immediate evacuation is recommended or ordered by authorized officials.', FRW:'A spreading wildfire or structural fire threatening a populated area.', HMW:'A hazardous material release that may require protective action.', LEW:'A serious law-enforcement incident that may threaten the public.', LAE:'A local event that may disrupt services or develop into a more serious emergency.', MEP:'A missing and endangered person alert under applicable criteria.', TOE:'A geographically identified outage affecting 911 telephone service.', NUW:'An emergency at a nuclear power plant that may require public protective action.', RHW:'A lost, discovered, or released radiological hazard.', SPW:'A warning recommending people shelter inside because of a hazard.', EQW:'Current or imminent earthquake activity.', VOW:'Current or imminent volcanic activity.',
});
export function eventExplanation(code) {
 if (EVENT_EXPLANATIONS[code]) return EVENT_EXPLANATIONS[code];
 const name=EAS_EVENTS[code]||'';
 if (name.endsWith('Watch')) return `A watch for ${name.slice(0,-6).toLowerCase()}: conditions may develop, but timing or location remains uncertain.`;
 if (name.endsWith('Warning')) return `A warning for ${name.slice(0,-8).toLowerCase()}: a significant hazard is occurring or expected soon.`;
 if (name.endsWith('Statement')) return `A statement with follow-up information about ${name.slice(0,-10).toLowerCase()}.`;
 return 'Refer to the official source and local alerting plan for this code.';
}
