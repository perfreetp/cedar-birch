import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';
import { store } from './network/store.js';

store.init();
createApp(App).mount('#app');
