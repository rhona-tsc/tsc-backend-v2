import React from 'react'
import Hero from '../components/Hero'
import NewActs from '../components/NewActs'
import BestSeller from '../components/BestSeller'
import OurPolicy from '../components/OurPolicy'
import SearchBar from '../components/SearchBar'
import NewsletterBox from '../components/NewsletterBox'
import { useEffect } from 'react'

const Home = () => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []); // runs once when component mounts
  return (
    <div>
      <Hero />
      <SearchBar />
      <NewActs />
      <BestSeller />
      <OurPolicy />
      <NewsletterBox />
    </div>
  )
}

export default Home
