import { render, screen } from '@testing-library/react';
import App from './App';

test('renders Helia home tagline', () => {
  render(<App />);
  expect(screen.getByText(/Know your body/i)).toBeInTheDocument();
  expect(screen.getByText(/^Helia$/i)).toBeInTheDocument();
});
