import Act from '../models/actModel.js';
import Availability from '../models/availabilityModel.js';
import Board from '../models/enquiryBoardItem.js';
import { isEnquiryOnlyLineup, websiteActView } from '../utils/websiteLineups.js';
import { bespokeBookingAction, sameLineup } from '../utils/enquiryLineupPresentation.js';

const placeKey = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

// Compatibility for already-issued Good News cart links. Resolve only the
// selected lineup and exact date/place; never substitute a public lineup.
export async function enquiryLineupLink(req, res) {
  res.set('Cache-Control', 'no-store');
  const { actId, lineupId, date, address } = req.query;
  if (![actId, lineupId].every(v => /^[a-f0-9]{24}$/i.test(String(v || ''))) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) || !placeKey(address)) {
    return res.status(400).json({ success: false, message: 'This booking link is incomplete. Please reply to your enquiry email.' });
  }
  try {
    const act = await Act.findById(actId).select('_id tscName hiddenWebsiteLineupIds lineups').lean();
    const lineup = act?.lineups?.find(l => sameLineup(l, lineupId));
    if (!lineup) return res.status(404).json({ success: false, message: 'Please reply to your enquiry email to confirm this lineup.' });
    if (!isEnquiryOnlyLineup(lineup)) {
      if (!websiteActView(act).lineups.some(l => sameLineup(l, lineupId))) {
        return res.status(409).json({ success: false, message: 'Please reply to your enquiry email to confirm this lineup.' });
      }
      return res.json({ success: true, bespoke: false });
    }
    const requests = await Availability.find({ actId, lineupId, dateISO: date })
      .select('enquiryId formattedAddress').limit(100).lean();
    const refs = [...new Set(requests.filter(r => placeKey(r.formattedAddress) === placeKey(address)).map(r => r.enquiryId).filter(Boolean))];
    if (refs.length !== 1) return res.status(409).json({ success: false, message: 'Please reply to your enquiry email so we can confirm your bespoke quote.' });
    const board = await Board.findOne({ enquiryRef: refs[0], actId, lineupId, eventDateISO: date }).select('agent').lean();
    if (!board) return res.status(409).json({ success: false, message: 'Please reply to your enquiry email so we can confirm your bespoke quote.' });
    return res.json({ success: true, bespoke: true, ...bespokeBookingAction({
      lineup, enquiryRef: refs[0], agent: board.agent, dateISO: date, actName: act.tscName,
    }) });
  } catch {
    return res.status(503).json({ success: false, message: 'Please reply to your enquiry email to confirm this booking.' });
  }
}
