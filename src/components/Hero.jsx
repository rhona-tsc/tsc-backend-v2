import React from 'react'
import { assets } from '../assets/assets'

const Hero = () => {
    return (
        <div className='top-16 flex flex-col sm:flex-row border border-[#414141] border-t-0'>

            {/* Hero Left Side */}
            <div className='w-full sm:w-1/2 flex items-center justify-center py-10 sm:py-0'>
                <div className='text-[#414141]'>
                    <div className='flex items-center gap-2'>
                        <p className='w-8 md:w-11 h-[2px] bg-[#414141]'></p>
                        <p className='font-medium text-sm md:text-base'>BOOK NOW</p>
                    </div>

                    <h1 className='prata-regular text-2xl sm:py-3 lg:text-5xl leading-relaxed'>Exceptional Event & Wedding Bands for Hire</h1>

                    <div className='flex items-center gap-2'>
                        <p className='font-semibold text-sm md:text-base'>LET'S GET THIS PARTY STARTED</p>
                        <p className='w-8 md:w-11 h-[1px] bg-[#414141]'></p>
                    </div>
                </div>
            </div>

            {/* Hero Right Side */}
                <img className='w-full sm:w-1/2' src={assets.hero_img} alt="" />
                
        </div>
    )
}

export default Hero
