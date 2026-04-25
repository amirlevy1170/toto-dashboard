import { NavLink } from 'react-router-dom';
import './Navbar.css';

export default function Navbar() {
  return (
    <nav className="navbar">
      <div className="navbar-brand">⚽ Toto Dashboard</div>
      <div className="navbar-links">
        <NavLink to="/" end>Home</NavLink>
        <NavLink to="/predictions">Predictions</NavLink>
        <NavLink to="/history">History</NavLink>
        <NavLink to="/leagues">Leagues</NavLink>
        <NavLink to="/models">Models</NavLink>
        <NavLink to="/backtest">Backtest</NavLink>
        <NavLink to="/forms">Forms</NavLink>
        <NavLink to="/walkforward">Walk-Forward</NavLink>
      </div>
    </nav>
  );
}
