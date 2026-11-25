(function () {
  'use strict';
  var zones = ['Asia/Shanghai', 'Asia/Tokyo', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'UTC'];
  var selected = ['Asia/Shanghai', 'Europe/London', 'America/New_York'];
  var select = document.getElementById('zone');
  var list = document.getElementById('clocks');

  zones.forEach(function (zone) {
    var option = document.createElement('option');
    option.value = zone;
    option.textContent = zone;
    select.appendChild(option);
  });

  function render() {
    list.textContent = '';
    selected.forEach(function (zone, index) {
      var item = document.createElement('li');
      var remove = document.createElement('button');
      remove.className = 'remove';
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', '移除 ' + zone);
      remove.addEventListener('click', function () {
        selected.splice(index, 1);
        render();
      });
      var city = document.createElement('div');
      city.className = 'city';
      city.textContent = zone;
      var time = document.createElement('div');
      time.className = 'time';
      time.dataset.zone = zone;
      item.append(remove, city, time);
      list.appendChild(item);
    });
    tick();
  }

  function tick() {
    var now = new Date();
    list.querySelectorAll('.time').forEach(function (node) {
      node.textContent = now.toLocaleTimeString('zh-CN', { timeZone: node.dataset.zone, hour12: false });
    });
  }

  document.getElementById('add').addEventListener('submit', function (event) {
    event.preventDefault();
    if (selected.indexOf(select.value) === -1) {
      selected.push(select.value);
      render();
    }
  });

  render();
  setInterval(tick, 1000);
})();
