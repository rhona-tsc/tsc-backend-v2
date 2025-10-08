// scripts/addTestMusician.js
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Musician from '../models/musicianModel.js';

dotenv.config();

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const musician = await Musician.create({
    firstName: 'Rhona',
    lastName: 'Downie',
    email: 'rhona@example.com',
    password: 'dummy', // not used here, just required
    phone: '+447885682367', // This MUST match the incoming WhatsApp
    address: {
      line1: '123 Music Street',
      town: 'London',
      county: 'Greater London',
      postcode: 'WC2H 9NE'
    },
    instrumentation: ['Vocals'],
    vocals: ['Lead Vocal'],
    deputy_contract_signed: true,
    status: 'approved'
  });

  console.log('✅ Dummy musician created:', musician);
  process.exit();
};

run();