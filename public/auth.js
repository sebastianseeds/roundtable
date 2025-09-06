class AuthManager {
    constructor() {
        this.token = localStorage.getItem('token');
        this.user = null;
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        if (this.token) {
            this.checkAuth();
        }
    }
    
    setupEventListeners() {
        const loginForm = document.getElementById('loginForm');
        const registerForm = document.getElementById('registerForm');
        const tabBtns = document.querySelectorAll('.tab-btn');
        
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => this.handleLogin(e));
        }
        
        if (registerForm) {
            registerForm.addEventListener('submit', (e) => this.handleRegister(e));
        }
        
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                this.switchTab(tab);
            });
        });
    }
    
    switchTab(tab) {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        
        document.querySelectorAll('.auth-form').forEach(form => {
            form.classList.toggle('active', form.id === `${tab}Form`);
        });
        
        document.querySelectorAll('.error-message').forEach(msg => {
            msg.classList.remove('show');
        });
    }
    
    async handleLogin(e) {
        e.preventDefault();
        const username = document.getElementById('loginUsername').value;
        const password = document.getElementById('loginPassword').value;
        
        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.token = data.token;
                this.user = data.user;
                localStorage.setItem('token', this.token);
                window.location.href = '/games.html';
            } else {
                this.showError('loginError', data.error || 'Login failed');
            }
        } catch (err) {
            this.showError('loginError', 'Connection error. Please try again.');
        }
    }
    
    async handleRegister(e) {
        e.preventDefault();
        const username = document.getElementById('registerUsername').value;
        const email = document.getElementById('registerEmail').value;
        const password = document.getElementById('registerPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        
        if (password !== confirmPassword) {
            this.showError('registerError', 'Passwords do not match');
            return;
        }
        
        if (password.length < 6) {
            this.showError('registerError', 'Password must be at least 6 characters');
            return;
        }
        
        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, email, password })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.token = data.token;
                this.user = data.user;
                localStorage.setItem('token', this.token);
                window.location.href = '/games.html';
            } else {
                this.showError('registerError', data.error || 'Registration failed');
            }
        } catch (err) {
            this.showError('registerError', 'Connection error. Please try again.');
        }
    }
    
    async checkAuth() {
        try {
            const response = await fetch('/api/user', {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.user = data.user;
                window.location.href = '/games.html';
            } else {
                localStorage.removeItem('token');
                this.token = null;
            }
        } catch (err) {
            console.error('Auth check failed:', err);
        }
    }
    
    showError(elementId, message) {
        const errorElement = document.getElementById(elementId);
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.classList.add('show');
            
            setTimeout(() => {
                errorElement.classList.remove('show');
            }, 5000);
        }
    }
}

const authManager = new AuthManager();