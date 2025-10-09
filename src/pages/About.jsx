import React, { useEffect } from 'react'
import Title from '../components/Title'
import { assets } from '../assets/assets'
import NewsletterBox from '../components/NewsletterBox'

const About = () => {
    useEffect(() => {
    window.scrollTo(0, 0);
  }, []); // runs once when component mounts

  return (
    <div><div className='text-2xl text-center pt-8 border-t'>
      <Title text1={'ABOUT'} text2={'US'}/>
      
    </div>

    <div className='my-10 flex flex-col md:flex-row gap-16'>
        <img   className='w-full md:w-auto md:max-w-[450px] h-auto object-cover'  src={assets.about_img} alt="" />
        <div className='flex flex-col justify-center gap-6 md:w-2/4 text-gray-600'>
          <p>  The Supreme Collective is a powerhouse of professional bands, delivering world-class live music for hire across the UK and beyond. We pride ourselves on exceptional musicianship, electrifying performances, and award-winning customer service—every single time. Our collective is made up of some of the most talented and sought-after musicians in the industry, backed by award-winning management with years of experience crafting unforgettable performances. Whether it’s a wedding, birthday party, corporate event, festival, summer ball, HM Forces event, or a New Year’s Eve celebration, our bands know how to bring the magic to your dance floor.  
          </p>
          <p>With a vast array of diverse acts, each playing to their strengths and offering something distinct, we’ve designed our roster to ensure there’s a perfect sound for everyone. Many of our musicians have been performing with us since 2014, forming a close-knit, professional family of over 1,000 incredibly talented, hardworking, and passionate musicians who take pride in delivering unforgettable live experiences. Every band in our collective is fully managed, ensuring that all the t’s are crossed and i’s are dotted well in advance of your big day. Our musicians arrive fully briefed, prepared, and ready to deliver a flawless performance, making your event both seamless and sensational.  
</p>

<p></p>
          <b className='text-gray-800'>Our Mission</b>
          <p>Our mission is simple: to bring outstanding live music to events of all sizes while making the booking process effortless, transparent, and enjoyable. We believe in the power of music to elevate moments, create lasting memories, and turn any gathering into something extraordinary. Our high-calibre musicians are always ready to bring another 5-star performance to life, and we’re committed to matching you with the perfect act to fit your vision. So, take your time, explore our bands, and when you find your perfect sound, book with confidence, knowing it'll be one of the best deicions you can make!</p>
        </div>
      </div>

      <div className='text-xl py-4'>
        <Title text1={'WHY'} text2={'CHOOSE US'} />
      </div>

      <div className='flex flex-col md:flex-row text-sm mb-20'>
        <div className=' border px-10 md:px-16 py-8 sm:py-20 flex flex-col gap-5'>
          <b>Quality Assurance</b>
          <p className='text-gray-600'>We meticulously select and vet each band and act to ensure it meets the highest quality standards.</p>
        </div>
        <div className='border px-10 md:px-16 py-8 sm:py-20 flex flex-col gap-5'>
          <b>Convenience</b>
          <p className='text-gray-600'>With our user-friendly interface and hassle-free shortlisting and booking process, finding a band for your perfect day has never been easier.</p>
        </div>
        <div className='border px-10 md:px-16 py-8 sm:py-20 flex flex-col gap-5'>
          <b>Exceptional Customer Service</b>
          <p className='text-gray-600'>Our team of dedicated professionals is here to assist you thoughout the process - ensuring your satisfaction is our top priority.</p>
        </div>
      </div>

      <NewsletterBox />

    </div>
  )
}

export default About
