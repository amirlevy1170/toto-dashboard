import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import History from './pages/History';
import Leagues from './pages/Leagues';
import Models from './pages/Models';
import Backtest from './pages/Backtest';
import Forms from './pages/Forms';
import Predictions from './pages/Predictions';

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
        <Route path="/forms" element={<Forms />} />
        <Route path="/predictions" element={<Predictions />} />
      </Routes>
    </BrowserRouter>
  );
}
