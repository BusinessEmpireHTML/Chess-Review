import { render } from 'preact';
import '@fontsource-variable/manrope';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';
import './styles/app.css';
import './styles/board.css';
import { App } from './ui/App';
import { applyThemeVars } from './ui/theme';

applyThemeVars();
render(<App />, document.getElementById('app')!);
