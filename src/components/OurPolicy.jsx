import React from 'react'
import { assets } from '../assets/assets'

const OurPolicy = () => {
  return (
    <div className='flex flex-col sm:flex-row justify-around gap-12 sm:gap-2 text-center py-20 text-xs sm:text-sm md:text-base text-gray-700'>
      
        <div>
            <img src={assets.exchange_icon} className='w-12 m-auto mb-5' alt="" />
            <p className='font-semibold'>Superior Act Management</p>
            <p className='text-gray-400'>We are here to make sure your entertainment is seamlessly integrated into your special day.</p>
        </div>

        <div>
            <img src={assets.quality_icon} className='w-12 m-auto mb-5' alt="" />
            <p className='font-semibold'>Quality Acts</p>
            <p className='text-gray-400'>With over a hundred 5-star Google Reviews and gushing clients up and down the country you can rest assured you're in experienced hands.</p>
        </div>

        <div>
            <img src={assets.support_img} className='w-12 m-auto mb-5' alt="" />
            <p className='font-semibold'>Full Support Policy</p>
            <p className='text-gray-400'>We are here to support you from start to finish, every step of the way.</p>
        </div>
    </div>
  )
}

export default OurPolicy
