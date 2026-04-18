import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import History from './pages/History';
import Leagues from './pages/Leagues';
import Models from './pages/Models';
import Backtest from './pages/Backtest';

export default function App() {
  return (
    <BrowserRouter basename="/toto-dashboard">
      <Navbar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/history" element={<History />} />
        <Route path="/leagues" element={<Leagues />} />
        <Route path="/models" element={<Models />} />
        <Route path="/backtest" element={<Backtest />} />
      </Routes>
    </BrowserRouter>
  );
}
