# Requires: icalendar, recurring-ical-events (install in a separate virtualenv).
from icalendar import Calendar
import recurring_ical_events, zipfile, json, datetime, os, argparse
from zoneinfo import ZoneInfo
parser = argparse.ArgumentParser(description='Normalize a complete native Google Calendar ZIP; no network access or calendar changes.')
parser.add_argument('zip')
parser.add_argument('--output-prefix', required=True)
parser.add_argument('--before', required=True, help='Exclusive London date, YYYY-MM-DD')
args = parser.parse_args()
path = args.zip
start=datetime.datetime(2000,1,1,tzinfo=datetime.timezone.utc)
end=datetime.datetime.fromisoformat(args.before).replace(tzinfo=ZoneInfo('Europe/London'))
raw=[];past=[];stats=[]
def address(v):return str(v or '').removeprefix('mailto:').removeprefix('MAILTO:').strip()
def plain(v):return str(v or '')
def iso(v):
 if v is None:return ''
 d=getattr(v,'dt',v)
 return d.isoformat() if hasattr(d,'isoformat') else str(d)
def row(e,cid,category,expanded=False):
 uid=plain(e.get('UID')); rec=iso(e.get('RECURRENCE-ID'));base=uid.removesuffix('@google.com')
 eid=base+(('_'+rec) if rec else '')
 guests=e.get('ATTENDEE',[]);guests=guests if isinstance(guests,list) else [guests]
 organizer=address(e.get('ORGANIZER'))
 result={'id':eid,'iCalUID':uid,'recurrenceId':rec,'calendarId':cid,'calendarCategory':category,'summary':plain(e.get('SUMMARY')),'description':plain(e.get('DESCRIPTION')),'location':plain(e.get('LOCATION')),'status':plain(e.get('STATUS') or 'CONFIRMED').lower(),'start':iso(e.get('DTSTART')),'end':iso(e.get('DTEND')),'organizer':{'email':organizer},'attendees':[{'email':address(a),'display_name':plain(a.params.get('CN')),'response_status':plain(a.params.get('PARTSTAT') or 'NEEDS-ACTION').lower().replace('needs-action','needsAction'),'optional':a.params.get('ROLE')=='OPT-PARTICIPANT','resource':a.params.get('CUTYPE')=='RESOURCE','organizer':address(a).lower()==organizer.lower()}for a in guests]}
 if not expanded:result['ical']=e.to_ical().decode('utf-8')
 return result
with zipfile.ZipFile(path) as z:
 for filename in z.namelist():
  if not filename.endswith('.ics'):continue
  title=filename.split('_',1)[0];cid=filename[len(title)+1:-4]
  category='performance' if title in ['The Supreme Collective','TSC Gigs','Calendar for Poptop syncing'] else 'availability' if 'Availability' in title else 'other'
  if title=='Birthdays':cid='birthdays:'+cid
  c=Calendar.from_ical(z.read(filename));entries=c.walk('VEVENT')
  raw.extend({**row(e,cid,category),'calendarName':title} for e in entries)
  expanded=recurring_ical_events.of(c).between(start,end) if category=='performance' else []
  past.extend(row(e,cid,category,True) for e in expanded)
  stats.append({'calendar':title,'calendarId':cid,'rawEvents':len(entries),'pastOccurrences':len(expanded),'category':category})
for name,data in [(args.output_prefix+'-raw.json',raw),(args.output_prefix+'-performances.json',past)]:
 fd=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
 with os.fdopen(fd,'w') as f:json.dump(data,f,ensure_ascii=False)
print(json.dumps({'rawEvents':len(raw),'pastPerformanceCalendarEntries':len(past),'calendars':stats},indent=2))
