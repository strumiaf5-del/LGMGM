// entrypoint for login.html
import './../../css/base/reset.css';
import './../../css/base/tokens.css';
import './../../css/base/themes.css';
import './../../css/base/themes-professional.css';
import './../../css/components/auth.css';
import './../../css/components/toast.css';

import { initLoginPage } from '../features/auth/login';
import '../features/ui/toast';

initLoginPage();
