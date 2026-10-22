// Manually checked against past event sheets on 22 October 2026.
// Deliberate public allowlist: no client identities, contacts, source document
// URLs, payment details, access pins or private notes. These are plans, not
// evidence that every timing happened, nor current venue rules.
export const venueEveningExamples = [
  {
    id: 'shoreditch-studios-evening', venueName: 'Shoreditch Studios', county: 'London', actSlug: 'soul-eras',
    month: 'October 2026', lineup: 'Five-piece band',
    summary: 'Two hour-long live sets, with DJ music between the sets and after the band.',
    rows: [['7:30–8:30pm', 'First live set'], ['8:30–8:50pm', 'DJ music'], ['8:50–9:50pm', 'Second live set'], ['9:50–10:30pm', 'DJ music'], ['10:30pm', 'Planned music finish']],
    note: 'Setup and soundcheck are not shown because the source timetable contains overlapping preparation entries.',
  },
  {
    id: 'allington-castle-evening', venueName: 'Allington Castle', county: 'Kent', actSlug: 'funk-royale',
    month: 'September 2026', lineup: 'Eight-piece band with saxophone and trumpet',
    summary: 'Three 40-minute live sets, with playlist music between them and a recorded first dance before the band.',
    rows: [['7:45pm', 'Cake cutting'], ['7:50pm', 'Recorded first dance'], ['7:55–8:35pm', 'First live set'], ['8:35–9:30pm', 'Playlist music'], ['9:30–10:10pm', 'Second live set'], ['10:10–11:05pm', 'Playlist music'], ['11:05–11:45pm', 'Third live set'], ['11:45pm', 'Planned music finish']],
    note: 'Setup and soundcheck are omitted because preparation timings in the source need clarification.',
  },
  {
    id: 'gaynes-park-evening', venueName: 'Gaynes Park', county: 'Essex', actSlug: 'one-love',
    month: 'July 2025', lineup: 'Five-piece band with female and male lead vocals',
    summary: 'Three 40-minute live sets, with a manned playlist between the sets and after the final performance.',
    rows: [['6–7pm', 'Band setup'], ['7–7:30pm', 'Soundcheck'], ['7:35–8:15pm', 'First live set'], ['8:15–9pm', 'Manned playlist'], ['9–9:40pm', 'Second live set'], ['9:40–10:10pm', 'Manned playlist'], ['10:10–10:50pm', 'Third live set'], ['10:50–11:45pm', 'Manned playlist'], ['11:45pm', 'Planned music finish']],
  },
  {
    id: 'pembroke-lodge-evening', venueName: 'Pembroke Lodge', room: 'Belvedere Suite', county: 'Surrey', actSlug: 'high-voltage',
    month: 'August 2026', lineup: 'Three-piece guitar, bass and drums lineup with vocals',
    summary: 'Three 40-minute live sets, with a manned playlist between them and a handover to the venue playlist afterwards.',
    rows: [['8:30–9:10pm', 'First live set'], ['9:10–9:40pm', 'Manned playlist'], ['9:40–10:20pm', 'Second live set'], ['10:20–10:50pm', 'Manned playlist'], ['10:50–11:30pm', 'Third live set'], ['11:30pm', 'Band finish and handover to the venue playlist']],
    note: 'Setup and soundcheck are not shown because the setup duration and timetable in the source do not agree.',
  },
  {
    id: 'brocket-hall-evening', venueName: 'Brocket Hall', county: 'Hertfordshire', actSlug: 'on-the-rocks',
    month: 'September 2026', lineup: 'Four-piece guitar-led band',
    summary: 'Three 40-minute live sets with playlist breaks, following an earlier setup and soundcheck.',
    rows: [['5:30pm', 'Setup starts'], ['6:30pm', 'Soundcheck starts'], ['9pm', 'First live set starts'], ['9:40pm', 'Playlist music'], ['10:10pm', 'Second live set starts'], ['10:50pm', 'Playlist music'], ['11:20pm', 'Third live set starts'], ['Midnight', 'Planned music finish']],
  },
];
