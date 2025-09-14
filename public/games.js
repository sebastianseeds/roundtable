class GamesManager {
    constructor() {
        this.token = localStorage.getItem('token');
        this.user = null;
        this.games = [];
        this.currentGameForAction = null;
        
        if (!this.token) {
            window.location.href = '/login.html';
            return;
        }
        
        this.init();
    }
    
    async init() {
        await this.loadUser();
        await this.loadGames();
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        document.getElementById('logoutBtn').addEventListener('click', () => this.logout());
        document.getElementById('createGameForm').addEventListener('submit', (e) => this.createGame(e));
        document.getElementById('joinGameForm').addEventListener('submit', (e) => this.joinGame(e));
        
        // Modal event listeners
        document.getElementById('cancelDelete').addEventListener('click', () => this.closeModal('deleteModal'));
        document.getElementById('confirmDelete').addEventListener('click', () => this.confirmDeletion());
        document.getElementById('cancelSettings').addEventListener('click', () => this.closeModal('settingsModal'));
        document.getElementById('settingsForm').addEventListener('submit', (e) => this.saveSettings(e));
        
        // Close modals when clicking outside
        document.getElementById('deleteModal').addEventListener('click', (e) => {
            if (e.target.id === 'deleteModal') this.closeModal('deleteModal');
        });
        document.getElementById('settingsModal').addEventListener('click', (e) => {
            if (e.target.id === 'settingsModal') this.closeModal('settingsModal');
        });
    }
    
    async loadUser() {
        try {
            const response = await fetch('/api/user', {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.user = data.user;
                document.getElementById('username').textContent = this.user.username;
            } else {
                this.logout();
            }
        } catch (err) {
            console.error('Failed to load user:', err);
            this.logout();
        }
    }
    
    async loadGames() {
        try {
            const response = await fetch('/api/games', {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.games = data.games;
                this.renderGames();
            }
        } catch (err) {
            console.error('Failed to load games:', err);
        }
    }
    
    renderGames() {
        const grid = document.getElementById('gamesGrid');
        
        if (this.games.length === 0) {
            grid.innerHTML = '<p style="color: #808080;">No campaigns yet. Create one to get started!</p>';
            return;
        }
        
        grid.innerHTML = this.games.map(game => {
            const isOwner = game.owner_id === this.user.id;
            const deletionRequested = game.deletion_requested;
            const deletionDate = deletionRequested ? new Date(game.deletion_requested_at) : null;
            const timeUntilDeletion = deletionDate ? Math.max(0, 7 * 24 * 60 * 60 * 1000 - (Date.now() - deletionDate.getTime())) : 0;
            
            return `
                <div class="game-card ${deletionRequested ? 'deletion-pending' : ''}" ${!deletionRequested ? `onclick="gamesManager.enterGame('${game.id}')"` : ''}>
                    <h3>${game.name}</h3>
                    <p>${game.description || 'No description'}</p>
                    
                    <div class="game-info">
                        <span class="role-badge ${game.role}">${game.role === 'king' ? '👑 Monarch' : '⚔️ Knight'}</span>
                        <span class="last-played">${this.formatDate(game.last_played)}</span>
                    </div>
                    
                    <div style="margin-top: 0.5rem;">
                        <small style="color: #606060;">
                            DM: ${game.owner_name} | ${this.getRuleSystemName(game.rule_system)} | ${this.getGridTypeName(game.grid_type)}
                        </small>
                    </div>
                    
                    ${deletionRequested ? `
                        <div class="deletion-warning">
                            ⚠️ <strong>Deletion Scheduled</strong><br>
                            <span class="deletion-timer">Deletes in: ${this.formatTimeRemaining(timeUntilDeletion)}</span>
                        </div>
                    ` : ''}
                    
                    ${isOwner ? `
                        <div class="game-actions">
                            <div>
                                ${!deletionRequested ? `<button onclick="event.stopPropagation(); gamesManager.openSettings('${game.id}')" class="btn-manage">Settings</button>` : ''}
                                ${this.user.is_dev ? `<button onclick="event.stopPropagation(); gamesManager.devDelete('${game.id}')" class="btn-dev" title="Dev: Instant Delete">⚡ Dev Delete</button>` : ''}
                            </div>
                            <div>
                                ${deletionRequested ? `
                                    <button onclick="event.stopPropagation(); gamesManager.cancelDeletionRequest('${game.id}')" class="btn-warning">Cancel Deletion</button>
                                ` : `
                                    <button onclick="event.stopPropagation(); gamesManager.requestDeletion('${game.id}')" class="btn-danger">Delete Campaign</button>
                                `}
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    }
    
    formatDate(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diff = now - date;
        
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
        if (diff < 604800000) return `${Math.floor(diff / 86400000)} days ago`;
        
        return date.toLocaleDateString();
    }
    
    formatTimeRemaining(ms) {
        const days = Math.floor(ms / (24 * 60 * 60 * 1000));
        const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
        const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
        
        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    }
    
    getRuleSystemName(system) {
        const systems = {
            'dnd5e': 'D&D 5e',
            'pathfinder2e': 'Pathfinder 2e',
            'dnd35': 'D&D 3.5',
            'callofcthulhu': 'Call of Cthulhu',
            'shadowrun': 'Shadowrun',
            'custom': 'Custom'
        };
        return systems[system] || 'D&D 5e';
    }
    
    getGridTypeName(type) {
        const types = {
            'square': 'Square Grid',
            'hexagon': 'Hex Grid',
            'continuous': 'Gridless'
        };
        return types[type] || 'Square Grid';
    }
    
    async createGame(e) {
        e.preventDefault();
        
        const name = document.getElementById('gameName').value;
        const description = document.getElementById('gameDescription').value;
        
        // Collect campaign settings
        const settings = {
            ruleSystem: document.getElementById('ruleSystem').value,
            gridType: document.getElementById('gridType').value,
            defaultGridSize: parseInt(document.getElementById('defaultGridSize').value),
            visionEnabled: document.getElementById('visionEnabled').checked,
            characterSheetTemplate: document.getElementById('characterSheetTemplate').value,
            tokenSettings: {
                showNames: true,
                showHealthBars: true,
                snapToGrid: true
            }
        };
        
        try {
            const response = await fetch('/api/games', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ name, description, settings })
            });
            
            if (response.ok) {
                document.getElementById('createGameForm').reset();
                await this.loadGames();
            } else {
                const error = await response.json();
                alert(error.error || 'Failed to create game');
            }
        } catch (err) {
            console.error('Failed to create game:', err);
            alert('Failed to create game');
        }
    }
    
    async joinGame(e) {
        e.preventDefault();
        
        const gameCode = document.getElementById('gameCode').value;
        const characterName = document.getElementById('characterName').value;
        
        try {
            const response = await fetch(`/api/games/${gameCode}/join`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ characterName })
            });
            
            if (response.ok) {
                document.getElementById('joinGameForm').reset();
                await this.loadGames();
            } else {
                const error = await response.json();
                alert(error.error || 'Failed to join game');
            }
        } catch (err) {
            console.error('Failed to join game:', err);
            alert('Failed to join game. Check the campaign code.');
        }
    }
    
    async requestDeletion(gameId) {
        if (!confirm('This will schedule your campaign for permanent deletion in 7 days. Are you sure?')) {
            return;
        }
        
        try {
            const response = await fetch(`/api/games/${gameId}/request-deletion`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            
            if (response.ok) {
                await this.loadGames();
                alert('Campaign scheduled for deletion. You have 7 days to cancel or confirm permanent deletion.');
            } else {
                const error = await response.json();
                alert(error.error || 'Failed to request deletion');
            }
        } catch (err) {
            console.error('Failed to request deletion:', err);
            alert('Failed to request deletion');
        }
    }
    
    async cancelDeletionRequest(gameId) {
        try {
            const response = await fetch(`/api/games/${gameId}/cancel-deletion`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            
            if (response.ok) {
                await this.loadGames();
                alert('Deletion request cancelled.');
            } else {
                const error = await response.json();
                alert(error.error || 'Failed to cancel deletion');
            }
        } catch (err) {
            console.error('Failed to cancel deletion:', err);
            alert('Failed to cancel deletion');
        }
    }
    
    openDeleteModal(gameId) {
        this.currentGameForAction = gameId;
        document.getElementById('deleteConfirmation').value = '';
        this.showModal('deleteModal');
    }
    
    async confirmDeletion() {
        const confirmation = document.getElementById('deleteConfirmation').value;
        
        if (confirmation !== 'DELETE MY CAMPAIGN PERMANENTLY') {
            alert('Confirmation text does not match. Please type exactly: DELETE MY CAMPAIGN PERMANENTLY');
            return;
        }
        
        try {
            const response = await fetch(`/api/games/${this.currentGameForAction}/confirm-deletion`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ confirmationText: confirmation })
            });
            
            if (response.ok) {
                this.closeModal('deleteModal');
                await this.loadGames();
                alert('Campaign permanently deleted.');
            } else {
                const error = await response.json();
                alert(error.error || 'Failed to delete campaign');
            }
        } catch (err) {
            console.error('Failed to delete campaign:', err);
            alert('Failed to delete campaign');
        }
    }
    
    async openSettings(gameId) {
        this.currentGameForAction = gameId;
        const game = this.games.find(g => g.id === gameId);
        
        if (!game) return;
        
        // Populate settings form with current values
        document.getElementById('settingsRuleSystem').value = game.rule_system || 'dnd5e';
        document.getElementById('settingsGridType').value = game.grid_type || 'square';
        document.getElementById('settingsGridSize').value = game.default_grid_size || 50;
        document.getElementById('settingsCharacterSheet').value = game.character_sheet_template || 'dnd5e';
        document.getElementById('settingsVisionEnabled').checked = game.vision_enabled || false;
        
        this.showModal('settingsModal');
    }
    
    async saveSettings(e) {
        e.preventDefault();
        
        const settings = {
            ruleSystem: document.getElementById('settingsRuleSystem').value,
            gridType: document.getElementById('settingsGridType').value,
            defaultGridSize: parseInt(document.getElementById('settingsGridSize').value),
            characterSheetTemplate: document.getElementById('settingsCharacterSheet').value,
            visionEnabled: document.getElementById('settingsVisionEnabled').checked
        };
        
        try {
            const response = await fetch(`/api/games/${this.currentGameForAction}/settings`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify(settings)
            });
            
            if (response.ok) {
                this.closeModal('settingsModal');
                await this.loadGames();
                alert('Settings updated successfully');
            } else {
                const error = await response.json();
                alert(error.error || 'Failed to update settings');
            }
        } catch (err) {
            console.error('Failed to update settings:', err);
            alert('Failed to update settings');
        }
    }
    
    async devDelete(gameId) {
        if (!confirm('DEV DELETE: This will instantly and permanently delete the campaign. Are you absolutely sure?')) {
            return;
        }
        
        try {
            const response = await fetch(`/api/games/${gameId}/dev-delete`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            
            if (response.ok) {
                await this.loadGames();
                alert('Campaign instantly deleted (dev mode)');
            } else {
                const error = await response.json();
                alert(error.error || 'Failed to delete campaign');
            }
        } catch (err) {
            console.error('Failed to delete campaign:', err);
            alert('Failed to delete campaign');
        }
    }
    
    showModal(modalId) {
        document.getElementById(modalId).style.display = 'flex';
    }
    
    closeModal(modalId) {
        document.getElementById(modalId).style.display = 'none';
        this.currentGameForAction = null;
    }
    
    enterGame(gameId) {
        sessionStorage.setItem('currentGame', gameId);
        window.location.href = '/';
    }
    
    logout() {
        localStorage.removeItem('token');
        sessionStorage.removeItem('currentGame');
        
        fetch('/api/logout', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.token}`
            }
        });
        
        window.location.href = '/login.html';
    }
}

const gamesManager = new GamesManager();