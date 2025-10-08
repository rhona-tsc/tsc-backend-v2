import bcrypt from 'bcryptjs';
import User from '../models/userModel.js';
import Musician from '../models/musicianModel.js';

export const changePhone = async (req, res) => {
  try {
    console.log(`🛠️  [${req._rid || 'no-rid'}] changePhone called`);

    const { newPhone, currentPassword } = req.body;
    console.log(`   • payload: { newPhone: ${String(newPhone || '').slice(0,20)}..., currentPassword: **** }`);

    if (!newPhone || !currentPassword) {
      return res.status(400).json({ success: false, message: 'Missing newPhone or currentPassword' });
    }

    const userId = req.user?.id || req.user?._id;
    console.log(`   • userId from auth: ${userId || 'none'}`);

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }

    // Try to find a User first
    let doc = await User.findById(userId).select('+password');
    let modelType = 'user';

    // If not found, try Musician
    if (!doc) {
      const Musician = await import('../models/musicianModel.js').then(mod => mod.default);
      doc = await Musician.findById(userId).select('+password');
      modelType = doc ? 'musician' : null;
    }

    console.log(`   • model found: ${doc ? (doc.constructor?.modelName || 'unknown') : 'none'}`);

    if (!doc) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    const passwordOk = await bcrypt.compare(currentPassword, doc.password);
    if (!passwordOk) {
      return res.status(400).json({ success: false, message: 'Incorrect password' });
    }

    // Support different phone field names across models
    if (Object.prototype.hasOwnProperty.call(doc, 'phoneNumber')) {
      doc.phoneNumber = newPhone.trim();
    } else {
      // common in musician model
      doc.phone = newPhone.trim();
    }

    console.log(`   • updating phone field on ${doc.constructor?.modelName || 'doc'} and saving`);
    await doc.save();

    return res.json({ success: true, model: modelType });
  } catch (err) {
    console.error(`❌ [${req._rid || 'no-rid'}] changePhone error:`, err);
    return res.status(500).json({ success: false, message: 'Server error updating phone number' });
  }
};

export const changeEmail = async (req, res) => {
  try {
    console.log(`🛠️  [${req._rid || 'no-rid'}] changeEmail called`);

    const { newEmail, currentPassword } = req.body;
    console.log(`   • payload: { newEmail: ${String(newEmail || '').slice(0,50)}..., currentPassword: **** }`);

    if (!newEmail || !currentPassword) {
      return res.status(400).json({ success: false, message: 'Missing newEmail or currentPassword' });
    }

    const userId = req.user?.id || req.user?._id;
    console.log(`   • userId from auth: ${userId || 'none'}`);
    if (!userId) return res.status(401).json({ success: false, message: 'Not authorized' });

    // Look up account in User then Musician
    let doc = await User.findById(userId).select('+password');
    let modelType = 'user';
    if (!doc) {
      doc = await Musician.findById(userId).select('+password');
      modelType = doc ? 'musician' : null;
    }

    console.log(`   • model found: ${doc ? (doc.constructor?.modelName || 'unknown') : 'none'}`);
    if (!doc) return res.status(404).json({ success: false, message: 'Account not found' });

    const passwordOk = await bcrypt.compare(currentPassword, doc.password);
    if (!passwordOk) return res.status(400).json({ success: false, message: 'Incorrect password' });

    // Ensure new email isn’t already used by another account
    const emailLower = String(newEmail).trim().toLowerCase();
    const existingUser = await User.findOne({ email: emailLower, _id: { $ne: doc._id } });
    const existingMusician = await Musician.findOne({ email: emailLower, _id: { $ne: doc._id } });
    if (existingUser || existingMusician) {
      return res.status(409).json({ success: false, message: 'Email already in use' });
    }

    doc.email = emailLower;
    await doc.save();

    return res.json({ success: true, model: modelType });
  } catch (err) {
    console.error(`❌ [${req._rid || 'no-rid'}] changeEmail error:`, err);
    return res.status(500).json({ success: false, message: 'Server error updating email' });
  }
};

export const changePassword = async (req, res) => {
  try {
    console.log(`🛠️  [${req._rid || 'no-rid'}] changePassword called`);

    const { currentPassword, newPassword } = req.body;
    console.log(`   • payload: { currentPassword: ****, newPassword: **** }`);

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Missing currentPassword or newPassword' });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ success: false, message: 'New password must be at least 8 characters' });
    }

    const userId = req.user?.id || req.user?._id;
    console.log(`   • userId from auth: ${userId || 'none'}`);
    if (!userId) return res.status(401).json({ success: false, message: 'Not authorized' });

    let doc = await User.findById(userId).select('+password');
    let modelType = 'user';
    if (!doc) {
      doc = await Musician.findById(userId).select('+password');
      modelType = doc ? 'musician' : null;
    }

    console.log(`   • model found: ${doc ? (doc.constructor?.modelName || 'unknown') : 'none'}`);
    if (!doc) return res.status(404).json({ success: false, message: 'Account not found' });

    const passwordOk = await bcrypt.compare(currentPassword, doc.password);
    if (!passwordOk) return res.status(400).json({ success: false, message: 'Incorrect password' });

    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(String(newPassword), salt);
    doc.password = hashed;
    await doc.save();

    return res.json({ success: true, model: modelType });
  } catch (err) {
    console.error(`❌ [${req._rid || 'no-rid'}] changePassword error:`, err);
    return res.status(500).json({ success: false, message: 'Server error updating password' });
  }
};
